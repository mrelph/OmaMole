import { access, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { run } from '../exec'
import { expandHome, safeRemove } from '../safety'
import type { DevArtifact, DevReport, RemoveResult } from '../types'
import { duBytes } from './common'

/* A directory is only an artifact when its project says so: `build` and
   `dist` are ordinary names, and deleting a hand-made build/ folder would be
   a real loss. Each rule names the sibling marker files that make the match
   safe; an empty list means the name alone is distinctive enough. */
export const ARTIFACT_RULES: Record<string, { kind: string; markers: string[]; inside?: string }> = {
  node_modules: { kind: 'node_modules', markers: ['package.json'] },
  target: { kind: 'Rust target', markers: ['Cargo.toml'] },
  __pycache__: { kind: '__pycache__', markers: [] },
  '.venv': { kind: 'virtualenv', markers: [], inside: 'pyvenv.cfg' },
  venv: { kind: 'virtualenv', markers: [], inside: 'pyvenv.cfg' },
  '.pytest_cache': { kind: 'pytest cache', markers: [] },
  '.mypy_cache': { kind: 'mypy cache', markers: [] },
  '.ruff_cache': { kind: 'ruff cache', markers: [] },
  '.tox': { kind: 'tox', markers: ['tox.ini', 'pyproject.toml', 'setup.py'] },
  dist: { kind: 'dist', markers: ['package.json', 'pyproject.toml', 'setup.py'] },
  build: { kind: 'build', markers: ['package.json', 'pyproject.toml', 'setup.py', 'CMakeLists.txt', 'build.gradle', 'build.gradle.kts'] },
  'dist-electron': { kind: 'dist', markers: ['package.json'] },
  '.next': { kind: 'Next.js', markers: ['package.json'] },
  '.nuxt': { kind: 'Nuxt', markers: ['package.json'] },
  '.svelte-kit': { kind: 'SvelteKit', markers: ['package.json'] },
  '.turbo': { kind: 'Turborepo', markers: ['package.json'] },
  '.parcel-cache': { kind: 'Parcel', markers: ['package.json'] },
  '.angular': { kind: 'Angular', markers: ['angular.json', 'package.json'] },
  '.gradle': { kind: 'Gradle', markers: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'] },
  '.zig-cache': { kind: 'Zig', markers: ['build.zig'] },
  'zig-out': { kind: 'Zig', markers: ['build.zig'] }
}

/* Never descend into these while looking for projects. */
const SKIP_DIRS = ['.git', '.cache', '.local', '.cargo', '.rustup', '.npm', '.pnpm-store', '.mozilla', '.config', '.var', 'snap', '.steam']

const exists = async (target: string) => {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function confirmArtifact(dirPath: string): Promise<string | null> {
  const rule = ARTIFACT_RULES[path.basename(dirPath)]
  if (!rule) return null
  const parent = path.dirname(dirPath)
  if (rule.inside && !(await exists(path.join(dirPath, rule.inside)))) return null
  if (rule.markers.length > 0) {
    let found = false
    for (const marker of rule.markers) {
      if (await exists(path.join(parent, marker))) {
        found = true
        break
      }
    }
    if (!found) return null
  }
  return rule.kind
}

const MAX_ARTIFACTS = 2000

export async function scanDev(rawRoot: string, olderThanDays: number, excludes: readonly string[] = []): Promise<DevReport> {
  const started = Date.now()
  const root = path.resolve(expandHome(rawRoot))
  const names = Object.keys(ARTIFACT_RULES)

  /* find: prune skip-dirs, then match artifact names and prune them too so a
     node_modules is reported once, never with every nested copy inside it. */
  const args = [root, '-xdev', '(']
  SKIP_DIRS.forEach((name, index) => {
    if (index > 0) args.push('-o')
    args.push('-name', name)
  })
  for (const exclude of excludes) args.push('-o', '-path', path.resolve(expandHome(exclude)))
  args.push(')', '-prune', '-o', '-type', 'd', '(')
  names.forEach((name, index) => {
    if (index > 0) args.push('-o')
    args.push('-name', name)
  })
  args.push(')', '-prune', '-printf', '%T@\t%p\n')

  const candidates: { path: string; mtimeMs: number }[] = []
  const result = await run('find', args, {
    timeoutMs: 180_000,
    onLine: (line) => {
      const tab = line.indexOf('\t')
      if (tab === -1 || candidates.length >= MAX_ARTIFACTS) return
      const candidatePath = line.slice(tab + 1)
      if (candidatePath === root) return
      candidates.push({ path: candidatePath, mtimeMs: Number(line.slice(0, tab)) * 1000 })
    }
  })

  const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 24 * 3600 * 1000 : Infinity
  const confirmed: { path: string; mtimeMs: number; kind: string }[] = []
  for (const candidate of candidates) {
    if (candidate.mtimeMs > cutoff) continue
    const kind = await confirmArtifact(candidate.path)
    if (kind) confirmed.push({ ...candidate, kind })
  }

  const sizes = new Map<string, number>()
  for (let i = 0; i < confirmed.length; i += 200) {
    for (const [key, value] of await duBytes(confirmed.slice(i, i + 200).map((entry) => entry.path), 180_000)) sizes.set(key, value)
  }

  const artifacts: DevArtifact[] = confirmed
    .map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      project: path.dirname(entry.path).replace(os.homedir(), '~'),
      bytes: sizes.get(entry.path) ?? 0,
      mtimeMs: entry.mtimeMs
    }))
    .sort((a, b) => b.bytes - a.bytes)

  return {
    root,
    artifacts,
    totalBytes: artifacts.reduce((sum, entry) => sum + entry.bytes, 0),
    elapsedMs: Date.now() - started,
    truncated: result.timedOut || candidates.length >= MAX_ARTIFACTS
  }
}

/* Re-validates every path from the renderer: it must still be a real
   directory (not a symlink), still match an artifact rule with its marker,
   and sit inside the home directory. */
export async function removeArtifacts(paths: readonly string[]): Promise<RemoveResult[]> {
  const home = os.homedir()
  const results: RemoveResult[] = []
  for (const target of paths.slice(0, MAX_ARTIFACTS)) {
    try {
      const info = await lstat(target)
      if (!info.isDirectory()) {
        results.push({ path: target, ok: false, bytes: 0, message: 'not a directory' })
        continue
      }
      if (!(await confirmArtifact(target))) {
        results.push({ path: target, ok: false, bytes: 0, message: 'no longer looks like a build artifact' })
        continue
      }
      const bytes = (await duBytes([target])).get(target) ?? 0
      const outcome = await safeRemove(target, [home])
      results.push({ path: target, ok: outcome.ok, bytes: outcome.ok ? bytes : 0, message: outcome.message })
    } catch (error) {
      results.push({ path: target, ok: false, bytes: 0, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
