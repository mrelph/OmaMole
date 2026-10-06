import { run, which } from '../exec'
import type { PackageUpdate, PackagesReport } from '../types'
import { duBytes, parseHumanSize } from './common'

/* "Installed Size  : 1.23 MiB" blocks from `pacman -Qi`, keyed by Name. */
export function parsePacmanInfo(text: string): { name: string; version: string; bytes: number }[] {
  const packages: { name: string; version: string; bytes: number }[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const field = (key: string) => block.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'))?.[1]?.trim()
    const name = field('Name')
    if (!name) continue
    packages.push({ name, version: field('Version') ?? '', bytes: parseHumanSize(field('Installed Size') ?? '') ?? 0 })
  }
  return packages
}

/* "name 1.0-1 -> 1.1-1" (checkupdates, yay -Qua, paru -Qua). */
export function parseUpdates(text: string, source: 'repo' | 'aur'): PackageUpdate[] {
  return text
    .split('\n')
    .map((line) => line.trim().match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ name: match[1], from: match[2], to: match[3], source }))
}

const nameVersion = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[0])
    .map(([name, version]) => ({ name, version }))

export async function aurHelper(): Promise<string | null> {
  for (const helper of ['yay', 'paru']) if (await which(helper)) return helper
  return null
}

/* checkupdates syncs a private copy of the databases, so it is safe without
   root and never leaves the system in a partial-upgrade state. Exit 2 means
   "no updates", not failure. */
export async function pendingUpdates(): Promise<{ updates: PackageUpdate[] | null; error?: string }> {
  if (!(await which('checkupdates'))) return { updates: null, error: 'Install pacman-contrib for checkupdates' }
  const repo = await run('checkupdates', ['--nocolor'], { timeoutMs: 60_000 })
  if (repo.timedOut) return { updates: null, error: 'checkupdates timed out (offline?)' }
  if (repo.code !== 0 && repo.code !== 2) {
    return { updates: null, error: repo.stderr.trim().split('\n').pop() || 'checkupdates failed' }
  }
  const updates = parseUpdates(repo.stdout, 'repo')
  const helper = await aurHelper()
  if (helper) {
    const aur = await run(helper, ['-Qua'], { timeoutMs: 60_000 })
    if (!aur.timedOut) updates.push(...parseUpdates(aur.stdout, 'aur'))
  }
  return { updates }
}

export async function findPacnew(): Promise<string[]> {
  const result = await run('find', ['/etc', '-xdev', '(', '-name', '*.pacnew', '-o', '-name', '*.pacsave', ')', '-type', 'f'], { timeoutMs: 20_000 })
  return result.stdout.split('\n').filter(Boolean).sort()
}

export async function packagesReport(): Promise<PackagesReport> {
  const [all, explicit, foreign, orphanList, info, updates, pacnew, cache, helper] = await Promise.all([
    run('pacman', ['-Qq'], { timeoutMs: 15_000 }),
    run('pacman', ['-Qqe'], { timeoutMs: 15_000 }),
    run('pacman', ['-Qm'], { timeoutMs: 15_000 }),
    run('pacman', ['-Qdt'], { timeoutMs: 15_000 }),
    run('pacman', ['-Qi'], { timeoutMs: 30_000 }),
    pendingUpdates(),
    findPacnew(),
    duBytes(['/var/cache/pacman/pkg']),
    aurHelper()
  ])
  const sized = parsePacmanInfo(info.stdout)
  const sizeOf = new Map(sized.map((pkg) => [pkg.name, pkg.bytes]))
  const count = (text: string) => text.split('\n').filter(Boolean).length

  return {
    installed: count(all.stdout),
    explicit: count(explicit.stdout),
    foreign: nameVersion(foreign.stdout),
    orphans: nameVersion(orphanList.stdout).map((pkg) => ({ ...pkg, bytes: sizeOf.get(pkg.name) ?? 0 })),
    updates: updates.updates,
    updatesError: updates.error,
    pacnew,
    largest: [...sized].sort((a, b) => b.bytes - a.bytes).slice(0, 25).map(({ name, bytes }) => ({ name, bytes })),
    cacheBytes: cache.get('/var/cache/pacman/pkg') ?? null,
    aurHelper: helper
  }
}
