import { lstat, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/* Every deletion OmaMole performs as the user goes through this module.
   System paths are never deleted here at all: those go through the
   privileged helper, which has its own fixed list of what it may touch. */

export const expandHome = (target: string, home = os.homedir()): string =>
  target === '~' ? home : target.startsWith('~/') ? path.join(home, target.slice(2)) : target

/* Directories that must never be removed themselves, though caches inside
   some of them are fair game. */
export const protectedExact = (home: string): string[] => [
  '/',
  home,
  ...[
    '.cache', '.config', '.local', '.local/share', '.local/state', '.npm', '.cargo',
    'Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Projects', 'Videos', 'Work'
  ].map((entry) => path.join(home, entry))
]

/* Trees nothing inside may be removed from, whatever a scan suggests. */
export const protectedTrees = (home: string): string[] => [
  path.join(home, '.ssh'),
  path.join(home, '.gnupg'),
  path.join(home, '.password-store'),
  path.join(home, '.local/share/keyrings'),
  path.join(home, '.config/omarchy'),
  path.join(home, '.local/state/omarchy')
]

export const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/* Returns a reason string when `target` may not be deleted, or null. Pure:
   checks the path's shape only, so it is testable without a filesystem. */
export function deletionProblem(target: string, allowedRoots: readonly string[], home = os.homedir()): string | null {
  if (typeof target !== 'string' || target.length === 0) return 'empty path'
  if (target.includes('\0')) return 'path contains a NUL byte'
  if (!path.isAbsolute(target)) return 'path is not absolute'
  if (target.split('/').includes('..')) return 'path contains ..'
  const normalized = path.normalize(target).replace(/\/+$/, '') || '/'
  if (normalized !== target && `${normalized}/` !== target) return 'path is not normalized'

  if (protectedExact(home).includes(normalized)) return 'path is protected'
  for (const tree of protectedTrees(home)) {
    if (normalized === tree || isInside(normalized, tree)) return 'path is inside a protected directory'
  }
  if (!allowedRoots.some((root) => isInside(normalized, root))) return 'path is outside the allowed locations'
  return null
}

export type RemoveOutcome = { ok: boolean; message?: string }

/* Removes one validated path. A symlink is unlinked, never followed. */
export async function safeRemove(target: string, allowedRoots: readonly string[]): Promise<RemoveOutcome> {
  const problem = deletionProblem(target, allowedRoots)
  if (problem) return { ok: false, message: problem }
  try {
    await lstat(target)
  } catch {
    return { ok: true, message: 'already gone' }
  }
  try {
    await rm(target, { recursive: true, force: false, maxRetries: 2 })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/* Empties a cache directory but keeps the directory itself, so apps that
   expect it to exist keep working. */
export async function clearContents(dir: string, allowedRoots: readonly string[]): Promise<RemoveOutcome> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return { ok: true, message: 'nothing to clear' }
  }
  const failures: string[] = []
  for (const entry of entries) {
    const outcome = await safeRemove(path.join(dir, entry), allowedRoots)
    if (!outcome.ok) failures.push(`${entry}: ${outcome.message}`)
  }
  return failures.length === 0 ? { ok: true } : { ok: false, message: failures.slice(0, 3).join('; ') }
}
