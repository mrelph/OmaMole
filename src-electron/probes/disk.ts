import { stat } from 'node:fs/promises'
import path from 'node:path'
import { run } from '../exec'
import { expandHome } from '../safety'
import type { DiskEntry, DiskMode, DiskReport } from '../types'
import { df } from './common'

const OLD_AFTER_MS = 180 * 24 * 3600 * 1000

/* Keeps only the N largest items seen so far without sorting the whole
   stream: a home directory with node_modules trees runs to millions of
   files, and holding them all would cost far more than the scan. */
export class TopN<T> {
  private items: T[] = []
  constructor(private readonly limit: number, private readonly weight: (item: T) => number) {}
  push(item: T) {
    if (this.items.length < this.limit) {
      this.items.push(item)
      if (this.items.length === this.limit) this.items.sort((a, b) => this.weight(a) - this.weight(b))
      return
    }
    if (this.weight(item) <= this.weight(this.items[0])) return
    this.items[0] = item
    /* one insertion pass keeps the array ascending */
    for (let i = 0; i + 1 < this.items.length && this.weight(this.items[i]) > this.weight(this.items[i + 1]); i += 1) {
      ;[this.items[i], this.items[i + 1]] = [this.items[i + 1], this.items[i]]
    }
  }
  values(): T[] {
    return [...this.items].sort((a, b) => this.weight(b) - this.weight(a))
  }
}

export const extensionOf = (name: string): string => {
  const base = name.toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return '(none)'
  const ext = base.slice(dot + 1)
  return ext.length > 12 || /[^a-z0-9_+-]/.test(ext) ? '(other)' : ext
}

async function folders(root: string, limit: number, excludes: readonly string[]) {
  const args = ['-B1', '-x', '-d', '1']
  for (const exclude of excludes) args.push(`--exclude=${exclude}`)
  args.push('--', root)
  const result = await run('du', args, { timeoutMs: 180_000 })
  const entries: DiskEntry[] = []
  let total = 0
  for (const line of result.stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const bytes = Number(line.slice(0, tab))
    const entryPath = line.slice(tab + 1)
    if (entryPath === root) {
      total = bytes
      continue
    }
    entries.push({ path: entryPath, name: path.basename(entryPath), bytes, kind: 'dir' })
  }
  entries.sort((a, b) => b.bytes - a.bytes)
  return { entries: entries.slice(0, limit), total, truncated: result.timedOut }
}

/* One streaming find pass serves files, types and old: size, mtime, path. */
async function walkFiles(root: string, excludes: readonly string[], visit: (bytes: number, mtimeMs: number, filePath: string) => void) {
  const args = [root, '-xdev']
  for (const exclude of excludes) args.push('-path', exclude, '-prune', '-o')
  args.push('-type', 'f', '-printf', '%s\t%T@\t%p\n')
  return run('find', args, {
    timeoutMs: 180_000,
    onLine: (line) => {
      const first = line.indexOf('\t')
      const second = line.indexOf('\t', first + 1)
      if (first === -1 || second === -1) return
      visit(Number(line.slice(0, first)), Number(line.slice(first + 1, second)) * 1000, line.slice(second + 1))
    }
  })
}

export async function analyzeDisk(rawRoot: string, mode: DiskMode, limit: number, excludes: readonly string[] = []): Promise<DiskReport> {
  const started = Date.now()
  const root = path.resolve(expandHome(rawRoot))
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error(`${root} is not a directory`)
  const cappedLimit = Math.min(Math.max(1, Math.floor(limit)), 500)
  const resolvedExcludes = excludes.map((entry) => path.resolve(expandHome(entry)))
  const fsRow = (await df(root))[0]
  const fs = fsRow ? { size: fsRow.size, used: fsRow.used, avail: fsRow.avail } : null

  if (mode === 'folders') {
    const { entries, total, truncated } = await folders(root, cappedLimit, resolvedExcludes)
    return { root, mode, entries, totalBytes: total, fs, elapsedMs: Date.now() - started, truncated }
  }

  let total = 0
  const now = Date.now()
  const top = new TopN<DiskEntry>(cappedLimit, (entry) => entry.bytes)
  const types = new Map<string, { bytes: number; count: number }>()

  const result = await walkFiles(root, resolvedExcludes, (bytes, mtimeMs, filePath) => {
    total += bytes
    if (mode === 'types') {
      const ext = extensionOf(path.basename(filePath))
      const bucket = types.get(ext) ?? { bytes: 0, count: 0 }
      bucket.bytes += bytes
      bucket.count += 1
      types.set(ext, bucket)
      return
    }
    if (mode === 'old' && now - mtimeMs < OLD_AFTER_MS) return
    top.push({ path: filePath, name: path.basename(filePath), bytes, kind: 'file', mtimeMs })
  })

  const entries: DiskEntry[] = mode === 'types'
    ? [...types.entries()]
        .map(([ext, bucket]) => ({ path: ext, name: ext === '(none)' || ext === '(other)' ? ext : `.${ext}`, bytes: bucket.bytes, count: bucket.count, kind: 'type' as const }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, cappedLimit)
    : top.values()

  return { root, mode, entries, totalBytes: total, fs, elapsedMs: Date.now() - started, truncated: result.timedOut }
}
