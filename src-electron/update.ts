import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateInfo } from './types'

/* Once a day, ask GitHub for the repo's tags (not /releases/latest: OmaMole
   ships tags, not Release objects, so that endpoint 404s). A newer tag shows
   up as a notice; installing it builds that tag's PKGBUILD in Omarchy's
   terminal. Ported from Inkwell's update.ts, with the IO injected so the
   logic is testable without Electron. */

export const TAGS_URL = 'https://api.github.com/repos/mrelph/OmaMole/tags?per_page=30'
export const PKGBUILD_URL = (version: string) => `https://raw.githubusercontent.com/mrelph/OmaMole/v${version}/packaging/PKGBUILD`
export const PACKAGED_ROOT = '/usr/lib/omamole'

const CHECK_EVERY = 24 * 60 * 60 * 1000
const TIMEOUT = 8000

type Version = [number, number, number]

/* Strict on purpose: prerelease or build suffixes are not worth a notice,
   and anything unparseable is not a version. */
export const parseVersion = (raw: unknown): Version | null => {
  if (typeof raw !== 'string') return null
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(raw.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export const compareVersions = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/* GitHub does not promise semver order, so take the maximum. */
export function newestTag(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null
  let best: Version | null = null
  for (const entry of payload) {
    const name = (entry as { name?: unknown } | null)?.name
    const parsed = parseVersion(name)
    if (parsed && (!best || compareVersions(parsed, best) > 0)) best = parsed
  }
  return best ? best.join('.') : null
}

export const isNewer = (candidate: string | null | undefined, current: string): boolean => {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  return !!a && !!b && compareVersions(a, b) > 0
}

type Cache = { checkedAt: number; latest?: string }

export type UpdateDeps = {
  current: string
  appRoot: string
  cacheDir: string
  enabled: () => Promise<boolean>
  fetchJson: (url: string, timeoutMs: number) => Promise<unknown>
}

export function createUpdater(deps: UpdateDeps) {
  const cacheFile = path.join(deps.cacheDir, 'update.json')
  let cache: Cache | null = null

  const readCache = async (): Promise<Cache> => {
    if (cache) return cache
    try {
      const raw = JSON.parse(await readFile(cacheFile, 'utf8')) as Record<string, unknown>
      cache = {
        checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : 0,
        latest: parseVersion(raw.latest) ? String(raw.latest) : undefined
      }
    } catch {
      cache = { checkedAt: 0 }
    }
    return cache
  }

  const writeCache = async (next: Cache) => {
    cache = next
    try {
      await mkdir(deps.cacheDir, { recursive: true })
      await writeFile(`${cacheFile}.tmp`, JSON.stringify(next), 'utf8')
      await rename(`${cacheFile}.tmp`, cacheFile)
    } catch {
      /* remembering is a convenience; asking again tomorrow is fine */
    }
  }

  /* After an update is installed under the running app, package.json on
     disk is newer than the code in memory: the app needs a restart. */
  const installedVersion = async (): Promise<string | null> => {
    try {
      const pkg = JSON.parse(await readFile(path.join(deps.appRoot, 'package.json'), 'utf8')) as { version?: unknown }
      return parseVersion(pkg.version) ? String(pkg.version) : null
    } catch {
      return null
    }
  }

  const describe = async (state: Cache, error?: string): Promise<UpdateInfo> => {
    const installed = await installedVersion()
    const restartNeeded = isNewer(installed, deps.current)
    const effective = restartNeeded && installed ? installed : deps.current
    return {
      current: deps.current,
      latest: state.latest ?? null,
      available: isNewer(state.latest, effective),
      installable: deps.appRoot === PACKAGED_ROOT,
      restartNeeded,
      installedVersion: installed,
      checkedAt: state.checkedAt || null,
      error
    }
  }

  /* Never rejects. A failed check does not stamp checkedAt, so a laptop that
     launched offline asks again next time instead of going quiet for a day. */
  const check = async (force = false): Promise<UpdateInfo> => {
    const state = await readCache()
    if (!(await deps.enabled())) return describe(state)
    if (!force && Date.now() - state.checkedAt < CHECK_EVERY) return describe(state)
    try {
      const latest = newestTag(await deps.fetchJson(TAGS_URL, TIMEOUT))
      if (!latest) return describe(state, 'No release tags found')
      const next = { checkedAt: Date.now(), latest }
      await writeCache(next)
      return describe(next)
    } catch (error) {
      return describe(state, force ? (error instanceof Error ? error.message : 'GitHub unreachable') : undefined)
    }
  }

  return { check }
}

/* The command the floating terminal runs: fetch the PKGBUILD committed at
   the release tag and build + install it. makepkg asks sudo for the password
   in that terminal; pacman shows the transaction before applying it. */
export function selfUpdateCommand(version: string): string | null {
  if (!parseVersion(version)) return null
  const url = PKGBUILD_URL(version)
  return [
    'dir=$(mktemp -d -t omamole-update.XXXXXX)',
    `cd "$dir" && curl -fsSL '${url}' -o PKGBUILD && makepkg -si`,
    'status=$?',
    'cd / && rm -rf "$dir"',
    `[ $status -eq 0 ] && echo && echo "OmaMole ${version} installed. Restart OmaMole to use it." || echo "Update failed (exit $status)."`
  ].join('; ')
}
