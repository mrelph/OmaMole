import { readFile } from 'node:fs/promises'
import { run } from '../exec'

/* Disk usage (allocated blocks, which is what deleting reclaims) for each
   path that exists. du exits non-zero on any unreadable subdirectory but
   still reports the rest, so output is parsed regardless of exit code. */
export async function duBytes(paths: readonly string[], timeoutMs = 60_000): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  if (paths.length === 0) return sizes
  const result = await run('du', ['-s', '-B1', '-x', '--', ...paths], { timeoutMs })
  for (const line of result.stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const bytes = Number(line.slice(0, tab))
    if (Number.isFinite(bytes)) sizes.set(line.slice(tab + 1), bytes)
  }
  return sizes
}

export const sumValues = (map: Map<string, number>): number => [...map.values()].reduce((a, b) => a + b, 0)

/* "1.05 GiB", "788 MiB", "1.3G", "512.0K" -> bytes. Accepts both the IEC
   suffixes paccache prints and the short ones journalctl prints. */
export function parseHumanSize(text: string): number | null {
  const match = text.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMGTP]?)(i?B)?$/i)
  if (!match) return null
  const power = ['', 'K', 'M', 'G', 'T', 'P'].indexOf(match[2].toUpperCase())
  return Math.round(Number(match[1]) * Math.pow(1024, power))
}

export type MemInfo = Record<string, number>

export function parseMeminfo(text: string): MemInfo {
  const info: MemInfo = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)(?:\s+kB)?/)
    if (match) info[match[1]] = Number(match[2]) * (line.includes('kB') ? 1024 : 1)
  }
  return info
}

export async function readMeminfo(): Promise<MemInfo> {
  return parseMeminfo(await readFile('/proc/meminfo', 'utf8'))
}

export type DfRow = { source: string; fstype: string; size: number; used: number; avail: number; mount: string }

export function parseDf(text: string): DfRow[] {
  const rows: DfRow[] = []
  for (const line of text.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const [source, fstype, size, used, avail, ...mount] = parts
    rows.push({ source, fstype, size: Number(size), used: Number(used), avail: Number(avail), mount: mount.join(' ') })
  }
  return rows
}

export async function df(target?: string): Promise<DfRow[]> {
  const args = ['-B1', '--output=source,fstype,size,used,avail,target']
  if (target) args.push('--', target)
  else args.push('-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'efivarfs', '-x', 'overlay', '-x', 'squashfs', '-x', 'fuse.gvfsd-fuse', '-x', 'ramfs')
  const result = await run('df', args, { timeoutMs: 8000 })
  return parseDf(result.stdout)
}
