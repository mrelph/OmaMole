import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Settings } from './types'

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'omamole')
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json')

export const defaultSettings = (home = os.homedir()): Settings => ({
  devRoots: [existsSync(path.join(home, 'Projects')) ? '~/Projects' : '~'],
  devOlderThanDays: 0,
  journalMaxSize: '200M',
  /* Omarchy's own `omarchy update pkg prune` keeps two: the cache is the only
     offline downgrade path. Same default here. */
  paccacheKeep: 2,
  diskRoot: '~',
  excludePaths: []
})

/* The settings file is user-editable, so every field is re-validated on load
   and a bad one falls back to its default instead of breaking startup. */
export function sanitizeSettings(input: unknown, fallback = defaultSettings()): Settings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const stringList = (value: unknown, fallbackList: string[]) =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length < 4096)
      ? (value as string[]).slice(0, 32)
      : fallbackList
  const integer = (value: unknown, min: number, max: number, fallbackValue: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallbackValue
  const pathLike = (value: unknown, fallbackValue: string) =>
    typeof value === 'string' && (value.startsWith('/') || value === '~' || value.startsWith('~/')) ? value : fallbackValue

  const devRoots = stringList(raw.devRoots, fallback.devRoots).filter((entry) => pathLike(entry, '') !== '')
  return {
    devRoots: devRoots.length > 0 ? devRoots : fallback.devRoots,
    devOlderThanDays: integer(raw.devOlderThanDays, 0, 3650, fallback.devOlderThanDays),
    journalMaxSize:
      typeof raw.journalMaxSize === 'string' && /^[1-9][0-9]{0,5}[KMG]$/.test(raw.journalMaxSize)
        ? raw.journalMaxSize
        : fallback.journalMaxSize,
    paccacheKeep: integer(raw.paccacheKeep, 0, 10, fallback.paccacheKeep),
    diskRoot: pathLike(raw.diskRoot, fallback.diskRoot),
    excludePaths: stringList(raw.excludePaths, fallback.excludePaths).filter((entry) => pathLike(entry, '') !== '')
  }
}

let current: Settings | null = null

export async function loadSettings(): Promise<Settings> {
  if (current) return current
  try {
    current = sanitizeSettings(JSON.parse(await readFile(SETTINGS_PATH, 'utf8')))
  } catch {
    current = defaultSettings()
  }
  return current
}

export async function saveSettings(next: unknown): Promise<Settings> {
  const clean = sanitizeSettings(next)
  await mkdir(CONFIG_DIR, { recursive: true })
  const temp = `${SETTINGS_PATH}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  await rename(temp, SETTINGS_PATH)
  current = clean
  return clean
}
