import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, which } from '../exec'
import type { OmarchyReport } from '../types'

const HOME = os.homedir()
const OMARCHY_PATH = process.env.OMARCHY_PATH || '/usr/share/omarchy'

const firstLine = async (command: string, args: string[] = []): Promise<string | null> => {
  if (!(await which(command))) return null
  const result = await run(command, args, { timeoutMs: 8000 })
  const line = result.stdout.trim().split('\n')[0]?.trim()
  return result.code === 0 && line ? line : null
}

const hyprJson = async <T>(what: string): Promise<T | null> => {
  const result = await run('hyprctl', [what, '-j'], { timeoutMs: 4000 })
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    return null
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

/* Active hooks are the files without the .sample suffix Omarchy ships. */
async function activeHooks(): Promise<string[]> {
  const root = path.join(HOME, '.config/omarchy/hooks')
  const hooks: string[] = []
  for (const event of await listDirs(root)) {
    try {
      for (const file of await readdir(path.join(root, event))) {
        if (!file.endsWith('.sample')) hooks.push(`${event.replace(/\.d$/, '')}/${file}`)
      }
    } catch {
      /* unreadable */
    }
  }
  return hooks.sort()
}

async function backups(): Promise<OmarchyReport['backups']> {
  const result = await run('find', [path.join(HOME, '.config'), '-maxdepth', '4', '-type', 'f', '-name', '*.bak.*', '-printf', '%s\t%T@\t%p\n'], { timeoutMs: 15_000 })
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [bytes, mtime, ...rest] = line.split('\t')
      return { path: rest.join('\t'), bytes: Number(bytes), mtimeMs: Number(mtime) * 1000 }
    })
    .filter((entry) => !entry.path.startsWith(path.join(HOME, '.config/omarchy') + '/'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export async function omarchyReport(): Promise<OmarchyReport> {
  const present = existsSync(OMARCHY_PATH)
  const hyprPresent = !!(await which('hyprctl')) && !!process.env.HYPRLAND_INSTANCE_SIGNATURE

  const [version, channel, updateResult, theme, font, hyprVersion, configErrors, monitors, backupList, plugins, hooks] = await Promise.all([
    firstLine('omarchy-version'),
    firstLine('omarchy-version-channel'),
    which('omarchy-update-available').then((found) => (found ? run('omarchy-update-available', [], { timeoutMs: 30_000 }) : null)),
    readFile(path.join(HOME, '.local/state/omarchy/current/theme.name'), 'utf8').then((text) => text.trim()).catch(() => null),
    firstLine('omarchy-font-current'),
    hyprPresent ? hyprJson<{ version?: string; tag?: string }>('version') : Promise.resolve(null),
    hyprPresent ? hyprJson<string[]>('configerrors') : Promise.resolve(null),
    hyprPresent ? hyprJson<{ name: string; description: string; width: number; height: number; refreshRate: number; scale: number }[]>('monitors') : Promise.resolve(null),
    backups(),
    listDirs(path.join(HOME, '.config/omarchy/plugins')),
    activeHooks()
  ])

  /* omarchy-update-available: exit 0 with one line per update, exit 1 with
     "Omarchy is up to date". */
  const update = updateResult && updateResult.code === 0 ? updateResult.stdout.trim().split('\n').filter(Boolean) : updateResult ? [] : null

  const snapperPresent = !!(await which('snapper'))

  return {
    present,
    version,
    channel,
    update,
    theme,
    font,
    hyprland: hyprPresent
      ? {
          version: hyprVersion?.version ?? hyprVersion?.tag ?? null,
          configErrors: (configErrors ?? []).map((error) => error.trim()).filter(Boolean),
          monitors: (monitors ?? []).map((monitor) => ({
            name: monitor.name,
            description: monitor.description,
            width: monitor.width,
            height: monitor.height,
            refresh: Math.round(monitor.refreshRate * 100) / 100,
            scale: monitor.scale
          }))
        }
      : null,
    backups: backupList,
    snapshots: snapperPresent
      ? { count: null, latest: null, error: 'listing needs root' }
      : { count: null, latest: null, error: 'snapper is not installed' },
    plugins,
    hooks
  }
}
