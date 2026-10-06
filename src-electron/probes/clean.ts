import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { run, which } from '../exec'
import { runHelper, type HelperStep } from '../privileged'
import { clearContents } from '../safety'
import { loadSettings } from '../settings'
import type { CleanCategory, CleanCategoryId, CleanPreview, CleanPreviewItem, CleanResult, Risk } from '../types'
import { duBytes, parseHumanSize, sumValues } from './common'

const HOME = os.homedir()
const home = (...parts: string[]) => path.join(HOME, ...parts)
const COREDUMP_DIR = '/var/lib/systemd/coredump'

/* User-owned cache locations per category. Only directories that exist are
   measured or touched, and each is emptied rather than removed. */
const USER_DIRS: Partial<Record<CleanCategoryId, string[]>> = {
  'aur-cache': [home('.cache/yay'), home('.cache/paru')],
  thumbnails: [home('.cache/thumbnails')],
  'browser-cache': [
    home('.cache/chromium'), home('.cache/google-chrome'), home('.cache/BraveSoftware'),
    home('.cache/microsoft-edge'), home('.cache/vivaldi'), home('.cache/mozilla'), home('.cache/zen')
  ],
  'dev-caches': [
    home('.npm/_cacache'), home('.cache/pip'), home('.cache/uv'), home('.cache/go-build'),
    home('.cache/yarn'), home('.cache/pnpm'), home('.local/share/pnpm/store'), home('.cargo/registry/cache'),
    home('.cache/node-gyp'), home('.cache/electron'), home('.cache/electron-builder'),
    home('.cache/debuginfod_client'), home('.bun/install/cache')
  ],
  trash: [home('.local/share/Trash/files'), home('.local/share/Trash/info'), home('.local/share/Trash/expunged')]
}

type Meta = { label: string; description: string; risk: Risk; privileged: boolean; defaultSelected: boolean }

export const CATEGORY_META: Record<CleanCategoryId, Meta> = {
  'pacman-cache': {
    label: 'Pacman cache',
    description: 'Old versions of installed packages beyond the newest kept (paccache).',
    risk: 'low', privileged: true, defaultSelected: true
  },
  'pacman-uninstalled': {
    label: 'Uninstalled packages',
    description: 'Cached package files for software that is no longer installed.',
    risk: 'low', privileged: true, defaultSelected: true
  },
  'aur-cache': {
    label: 'AUR build cache',
    description: 'yay / paru clones and built packages. Rebuilt on the next AUR update.',
    risk: 'low', privileged: false, defaultSelected: true
  },
  journal: {
    label: 'Systemd journal',
    description: 'Archived logs beyond the size limit set in Settings.',
    risk: 'low', privileged: true, defaultSelected: true
  },
  thumbnails: {
    label: 'Thumbnails',
    description: 'Image previews; regenerated when a file manager needs them.',
    risk: 'low', privileged: false, defaultSelected: true
  },
  coredumps: {
    label: 'Crash dumps',
    description: 'systemd-coredump files. Keep them while you are still diagnosing a crash.',
    risk: 'medium', privileged: true, defaultSelected: false
  },
  'browser-cache': {
    label: 'Browser caches',
    description: 'Chromium, Brave, Edge and Firefox disk caches. Close the browser first.',
    risk: 'medium', privileged: false, defaultSelected: false
  },
  'dev-caches': {
    label: 'Toolchain caches',
    description: 'npm, pnpm, pip, uv, Go, Cargo and Electron download caches.',
    risk: 'medium', privileged: false, defaultSelected: false
  },
  trash: {
    label: 'Trash',
    description: 'Files you moved to the trash. Emptying it is permanent.',
    risk: 'review', privileged: false, defaultSelected: false
  },
  'config-backups': {
    label: 'Config backups',
    description: 'Timestamped *.bak.* copies left in ~/.config by omarchy refresh and plugins. Moved to trash.',
    risk: 'review', privileged: false, defaultSelected: false
  }
}

export const CATEGORY_ORDER = Object.keys(CATEGORY_META) as CleanCategoryId[]

/* "==> finished dry run: 6 candidates (disk space saved: 788 MiB)" */
export function parsePaccacheSummary(output: string): { count: number; bytes: number } {
  const match = output.match(/finished dry run: (\d+) candidates? \(disk space saved: ([^)]+)\)/)
  if (!match) return { count: 0, bytes: 0 }
  return { count: Number(match[1]), bytes: parseHumanSize(match[2]) ?? 0 }
}

/* "Archived and active journals take up 1.3G in the file system." */
export function parseJournalUsage(output: string): number | null {
  const match = output.match(/take up ([0-9.]+[KMGTP]?)/)
  return match ? parseHumanSize(match[1]) : null
}

const existing = async (dirs: readonly string[]): Promise<string[]> => {
  const found: string[] = []
  for (const dir of dirs) {
    try {
      if ((await stat(dir)).isDirectory()) found.push(dir)
    } catch {
      /* absent */
    }
  }
  return found
}

async function findConfigBackups(): Promise<CleanPreviewItem[]> {
  const result = await run('find', [home('.config'), '-maxdepth', '4', '-type', 'f', '-name', '*.bak.*', '-printf', '%s\t%p\n'], { timeoutMs: 15_000 })
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t')
      return { bytes: Number(line.slice(0, tab)), path: line.slice(tab + 1) }
    })
    .filter((item) => !item.path.startsWith(home('.config/omarchy') + '/'))
}

async function coredumpFiles(): Promise<CleanPreviewItem[]> {
  try {
    const names = (await readdir(COREDUMP_DIR)).filter((name) => name.startsWith('core.'))
    const items: CleanPreviewItem[] = []
    for (const name of names) {
      try {
        const info = await stat(path.join(COREDUMP_DIR, name))
        items.push({ path: path.join(COREDUMP_DIR, name), bytes: info.size })
      } catch {
        /* raced away */
      }
    }
    return items
  } catch {
    return []
  }
}

async function journalUsage(): Promise<number | null> {
  const result = await run('journalctl', ['--disk-usage'], { timeoutMs: 10_000 })
  return parseJournalUsage(result.stdout + result.stderr)
}

async function measure(id: CleanCategoryId): Promise<Pick<CleanCategory, 'bytes' | 'items' | 'detail' | 'available' | 'reason'>> {
  const settings = await loadSettings()
  switch (id) {
    case 'pacman-cache':
    case 'pacman-uninstalled': {
      if (!(await which('paccache'))) return { bytes: null, items: null, available: false, reason: 'Install pacman-contrib for paccache' }
      const args = id === 'pacman-cache' ? ['-d', '-k', String(settings.paccacheKeep)] : ['-d', '-u', '-k', '0']
      const result = await run('paccache', args, { timeoutMs: 30_000 })
      const { count, bytes } = parsePaccacheSummary(result.stdout + result.stderr)
      return {
        bytes, items: count, available: true,
        detail: id === 'pacman-cache' ? `keeps ${settings.paccacheKeep} per package` : undefined
      }
    }
    case 'journal': {
      const usage = await journalUsage()
      if (usage === null) return { bytes: null, items: null, available: false, reason: 'journalctl unavailable' }
      const limit = parseHumanSize(settings.journalMaxSize) ?? 0
      return { bytes: Math.max(0, usage - limit), items: null, available: true, detail: `uses ${formatShort(usage)}, limit ${settings.journalMaxSize}` }
    }
    case 'coredumps': {
      const files = await coredumpFiles()
      return { bytes: files.reduce((a, f) => a + f.bytes, 0), items: files.length, available: true }
    }
    case 'config-backups': {
      const files = await findConfigBackups()
      return { bytes: files.reduce((a, f) => a + f.bytes, 0), items: files.length, available: true }
    }
    default: {
      const dirs = await existing(USER_DIRS[id] ?? [])
      if (dirs.length === 0) return { bytes: 0, items: 0, available: true, detail: 'nothing found' }
      const sizes = await duBytes(dirs)
      return {
        bytes: sumValues(sizes), items: dirs.length, available: true,
        detail: dirs.map((dir) => dir.replace(HOME, '~')).join(', ')
      }
    }
  }
}

const formatShort = (bytes: number) => {
  const units = ['B', 'K', 'M', 'G', 'T']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)}${units[unit]}`
}

export async function listCategories(): Promise<CleanCategory[]> {
  const measured = await Promise.all(CATEGORY_ORDER.map((id) => measure(id).catch(() => ({ bytes: null, items: null, available: false, reason: 'measurement failed' }))))
  return CATEGORY_ORDER.map((id, index) => ({ id, ...CATEGORY_META[id], ...measured[index] }))
}

export async function previewCategory(id: CleanCategoryId): Promise<CleanPreview> {
  const settings = await loadSettings()
  switch (id) {
    case 'pacman-cache':
    case 'pacman-uninstalled': {
      const args = id === 'pacman-cache' ? ['-d', '-v', '-k', String(settings.paccacheKeep)] : ['-d', '-v', '-u', '-k', '0']
      const result = await run('paccache', args, { timeoutMs: 30_000 })
      const files = result.stdout.split('\n').filter((line) => /\.pkg\.tar\.[a-z0-9]+$/.test(line.trim()))
      const sizes = await Promise.all(files.map(async (name) => {
        try {
          return (await stat(path.join('/var/cache/pacman/pkg', name.trim()))).size
        } catch {
          return 0
        }
      }))
      return {
        id,
        items: files.map((name, index) => ({ path: name.trim(), bytes: sizes[index] })).sort((a, b) => b.bytes - a.bytes),
        command: `paccache -r ${id === 'pacman-cache' ? `-k ${settings.paccacheKeep}` : '-u -k 0'}`,
        note: 'Signature files (.sig) are removed alongside each package.'
      }
    }
    case 'journal':
      return {
        id, items: [],
        command: `journalctl --vacuum-size=${settings.journalMaxSize}`,
        note: 'Archived journal files are removed oldest-first until the journal fits the limit. The active journal is never touched.'
      }
    case 'coredumps':
      return { id, items: (await coredumpFiles()).sort((a, b) => b.bytes - a.bytes), command: `rm ${COREDUMP_DIR}/core.*` }
    case 'config-backups':
      return { id, items: (await findConfigBackups()).sort((a, b) => b.bytes - a.bytes), note: 'Each file is moved to the trash, not deleted.' }
    default: {
      const dirs = await existing(USER_DIRS[id] ?? [])
      const children: string[] = []
      for (const dir of dirs) {
        try {
          for (const entry of await readdir(dir)) children.push(path.join(dir, entry))
        } catch {
          /* unreadable */
        }
      }
      const sizes = await duBytes(children.slice(0, 400))
      return {
        id,
        items: [...sizes.entries()].map(([itemPath, bytes]) => ({ path: itemPath, bytes })).sort((a, b) => b.bytes - a.bytes),
        note: children.length > 400 ? `Showing 400 of ${children.length} entries.` : 'The directories themselves are kept; only their contents are removed.'
      }
    }
  }
}

export type CleanDeps = { trashItem: (target: string) => Promise<void> }

export async function runCategories(ids: readonly CleanCategoryId[], deps: CleanDeps): Promise<CleanResult[]> {
  const settings = await loadSettings()
  const unique = CATEGORY_ORDER.filter((id) => ids.includes(id))
  const measureAll = async () =>
    new Map(await Promise.all(unique.map(async (id) => [id, (await measure(id).catch(() => null))?.bytes ?? 0] as const)))
  const before = await measureAll()
  const results: CleanResult[] = []

  /* Privileged categories: one helper call, one password prompt. */
  const steps: { id: CleanCategoryId; step: HelperStep }[] = []
  for (const id of unique) {
    if (id === 'pacman-cache') steps.push({ id, step: { action: 'paccache-keep', arg: String(settings.paccacheKeep) } })
    if (id === 'pacman-uninstalled') steps.push({ id, step: { action: 'paccache-uninstalled' } })
    if (id === 'journal') steps.push({ id, step: { action: 'journal-vacuum', arg: settings.journalMaxSize } })
    if (id === 'coredumps') steps.push({ id, step: { action: 'coredumps' } })
  }
  if (steps.length > 0) {
    const { outcomes, error } = await runHelper(steps.map((entry) => entry.step))
    for (const { id, step } of steps) {
      const outcome = outcomes.find((entry) => entry.action === step.action)
      results.push({
        id,
        ok: outcome?.ok ?? false,
        freedBytes: 0,
        message: outcome?.message || error || 'no result from helper'
      })
    }
  }

  for (const id of unique) {
    if (CATEGORY_META[id].privileged) continue
    if (id === 'config-backups') {
      const files = await findConfigBackups()
      let freed = 0
      const failures: string[] = []
      for (const file of files) {
        try {
          await deps.trashItem(file.path)
          freed += file.bytes
        } catch {
          failures.push(path.basename(file.path))
        }
      }
      results.push({ id, ok: failures.length === 0, freedBytes: freed, message: failures.length ? `could not trash ${failures.length} file(s)` : `moved ${files.length} file(s) to trash` })
      continue
    }
    const dirs = await existing(USER_DIRS[id] ?? [])
    const failures: string[] = []
    for (const dir of dirs) {
      const outcome = await clearContents(dir, [HOME])
      if (!outcome.ok) failures.push(outcome.message ?? dir)
    }
    results.push({
      id,
      ok: failures.length === 0,
      freedBytes: 0,
      message: failures.length ? failures.join('; ') : `cleared ${dirs.length} location(s)`
    })
  }

  /* Freed space is measured, not assumed: the same probe before and after. */
  const after = await measureAll()
  for (const result of results) {
    if (result.id === 'config-backups') continue
    result.freedBytes = Math.max(0, (before.get(result.id) ?? 0) - (after.get(result.id) ?? 0))
  }
  return results
}
