import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseHelperOutput } from '../src-electron/privileged'
import { parseDf, parseHumanSize, parseMeminfo } from '../src-electron/probes/common'
import { parseJournalUsage, parsePaccacheSummary } from '../src-electron/probes/clean'
import { confirmArtifact } from '../src-electron/probes/dev'
import { extensionOf, TopN } from '../src-electron/probes/disk'
import { parsePacmanInfo, parseUpdates } from '../src-electron/probes/packages'
import { gradeFor, scoreSystem, type ScanInputs } from '../src-electron/probes/scan'
import { parseProcStat } from '../src-electron/probes/system'
import { clearContents, deletionProblem, expandHome } from '../src-electron/safety'
import { defaultSettings, sanitizeSettings } from '../src-electron/settings'
import { terminalCommand } from '../src-electron/terminal'
import { buildPalette, contrast, parseColorsToml } from '../src-electron/theme'

const HOME = '/home/tester'

describe('deletionProblem', () => {
  const roots = [HOME]
  it('allows a cache path inside home', () => {
    expect(deletionProblem(`${HOME}/.cache/yay/foo`, roots, HOME)).toBeNull()
  })
  it('refuses relative paths, traversal and NUL bytes', () => {
    expect(deletionProblem('.cache/yay', roots, HOME)).toMatch(/absolute/)
    expect(deletionProblem(`${HOME}/.cache/../.ssh`, roots, HOME)).toMatch(/\.\./)
    expect(deletionProblem(`${HOME}/.cache/a\0b`, roots, HOME)).toMatch(/NUL/)
    expect(deletionProblem(`${HOME}//.cache//x`, roots, HOME)).toMatch(/normalized/)
  })
  it('refuses protected directories themselves', () => {
    for (const target of ['/', HOME, `${HOME}/.cache`, `${HOME}/.config`, `${HOME}/Documents`, `${HOME}/Projects`]) {
      expect(deletionProblem(target, roots, HOME)).not.toBeNull()
    }
  })
  it('refuses anything inside protected trees', () => {
    expect(deletionProblem(`${HOME}/.ssh/id_ed25519`, roots, HOME)).toMatch(/protected/)
    expect(deletionProblem(`${HOME}/.gnupg/private-keys-v1.d`, roots, HOME)).toMatch(/protected/)
    expect(deletionProblem(`${HOME}/.config/omarchy/shell.json`, roots, HOME)).toMatch(/protected/)
  })
  it('refuses paths outside the allowed roots', () => {
    expect(deletionProblem('/var/cache/pacman/pkg/x.pkg.tar.zst', roots, HOME)).toMatch(/outside/)
    expect(deletionProblem('/home/testerx/file', roots, HOME)).toMatch(/outside/)
  })
  it('accepts a single trailing slash', () => {
    expect(deletionProblem(`${HOME}/.cache/yay/`, roots, HOME)).toBeNull()
  })
  it('expands ~', () => {
    expect(expandHome('~/x', HOME)).toBe(`${HOME}/x`)
    expect(expandHome('~', HOME)).toBe(HOME)
    expect(expandHome('/abs', HOME)).toBe('/abs')
  })
})

describe('settings', () => {
  it('keeps valid values and replaces invalid ones with defaults', () => {
    const fallback = defaultSettings(HOME)
    const clean = sanitizeSettings({
      devRoots: ['~/code', 'relative/bad'],
      devOlderThanDays: 30,
      journalMaxSize: '500M; rm -rf /',
      paccacheKeep: 99,
      diskRoot: '/data',
      excludePaths: 'nope'
    }, fallback)
    expect(clean.devRoots).toEqual(['~/code'])
    expect(clean.devOlderThanDays).toBe(30)
    expect(clean.journalMaxSize).toBe(fallback.journalMaxSize)
    expect(clean.paccacheKeep).toBe(fallback.paccacheKeep)
    expect(clean.diskRoot).toBe('/data')
    expect(clean.excludePaths).toEqual([])
  })
  it('survives garbage', () => {
    expect(sanitizeSettings(null)).toBeTruthy()
    expect(sanitizeSettings('x').journalMaxSize).toMatch(/^[0-9]+[KMG]$/)
  })
})

describe('parsers', () => {
  it('reads paccache dry-run summaries', () => {
    expect(parsePaccacheSummary('==> finished dry run: 6 candidates (disk space saved: 788 MiB)')).toEqual({ count: 6, bytes: 788 * 1024 ** 2 })
    expect(parsePaccacheSummary('==> no candidate packages found for pruning')).toEqual({ count: 0, bytes: 0 })
    expect(parsePaccacheSummary('==> finished dry run: 1 candidate (disk space saved: 1.05 GiB)').bytes).toBe(Math.round(1.05 * 1024 ** 3))
  })
  it('reads journalctl --disk-usage', () => {
    expect(parseJournalUsage('Archived and active journals take up 1.3G in the file system.')).toBe(Math.round(1.3 * 1024 ** 3))
    expect(parseJournalUsage('nonsense')).toBeNull()
  })
  it('reads human sizes in both styles', () => {
    expect(parseHumanSize('512.0 KiB')).toBe(512 * 1024)
    expect(parseHumanSize('2G')).toBe(2 * 1024 ** 3)
    expect(parseHumanSize('17 B')).toBe(17)
    expect(parseHumanSize('lots')).toBeNull()
  })
  it('reads pacman -Qi blocks', () => {
    const text = 'Name            : foo\nVersion         : 1.0-1\nInstalled Size  : 2.00 MiB\n\nName            : bar\nVersion         : 2-1\nInstalled Size  : 512.00 KiB\n'
    expect(parsePacmanInfo(text)).toEqual([
      { name: 'foo', version: '1.0-1', bytes: 2 * 1024 ** 2 },
      { name: 'bar', version: '2-1', bytes: 512 * 1024 }
    ])
  })
  it('reads checkupdates / yay -Qua lines', () => {
    expect(parseUpdates('linux 6.1-1 -> 6.2-1\n\ngarbage line\nyay 12 -> 13 [ignored]\n', 'repo')).toEqual([
      { name: 'linux', from: '6.1-1', to: '6.2-1', source: 'repo' },
      { name: 'yay', from: '12', to: '13', source: 'repo' }
    ])
  })
  it('reads /proc/<pid>/stat with awkward comm names', () => {
    const fields = Array.from({ length: 50 }, (_, index) => String(index))
    const line = `123 (Web Content (x)) S ${fields.slice(4).join(' ')}`
    const sample = parseProcStat(line)
    expect(sample?.name).toBe('Web Content (x)')
    expect(sample?.ticks).toBe(14 + 15)
    expect(sample?.rssPages).toBe(24)
  })
  it('reads meminfo and df', () => {
    expect(parseMeminfo('MemTotal:       1000 kB\nMemAvailable:    500 kB\nHugePages_Total:       0\n')).toEqual({ MemTotal: 1024000, MemAvailable: 512000, HugePages_Total: 0 })
    expect(parseDf('Filesystem Type 1B-blocks Used Avail Mounted on\n/dev/a btrfs 100 40 60 /\n/dev/b vfat 10 1 9 /boot efi\n')).toEqual([
      { source: '/dev/a', fstype: 'btrfs', size: 100, used: 40, avail: 60, mount: '/' },
      { source: '/dev/b', fstype: 'vfat', size: 10, used: 1, avail: 9, mount: '/boot efi' }
    ])
  })
  it('reads helper RESULT lines and ignores noise', () => {
    expect(parseHelperOutput('noise\nRESULT journal-vacuum ok Vacuuming done, freed 1.1G\nRESULT coredumps fail could not remove coredumps\n')).toEqual([
      { action: 'journal-vacuum', ok: true, message: 'Vacuuming done, freed 1.1G' },
      { action: 'coredumps', ok: false, message: 'could not remove coredumps' }
    ])
  })
})

describe('disk helpers', () => {
  it('keeps the N largest in descending order', () => {
    const top = new TopN<number>(3, (value) => value)
    for (const value of [5, 1, 9, 3, 7, 2, 8]) top.push(value)
    expect(top.values()).toEqual([9, 8, 7])
  })
  it('classifies extensions', () => {
    expect(extensionOf('a.tar.zst')).toBe('zst')
    expect(extensionOf('.bashrc')).toBe('(none)')
    expect(extensionOf('Makefile')).toBe('(none)')
    expect(extensionOf('x.thisisaverylongext')).toBe('(other)')
  })
})

describe('dev artifact confirmation', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'omamole-test-'))
    await mkdir(path.join(dir, 'webapp/node_modules'), { recursive: true })
    await writeFile(path.join(dir, 'webapp/package.json'), '{}')
    await mkdir(path.join(dir, 'notes/build'), { recursive: true })
    await mkdir(path.join(dir, 'py/.venv'), { recursive: true })
    await writeFile(path.join(dir, 'py/.venv/pyvenv.cfg'), 'home = /usr/bin')
    await mkdir(path.join(dir, 'other/.venv'), { recursive: true })
    await mkdir(path.join(dir, 'rust/target'), { recursive: true })
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('matches only with the project marker present', async () => {
    expect(await confirmArtifact(path.join(dir, 'webapp/node_modules'))).toBe('node_modules')
    expect(await confirmArtifact(path.join(dir, 'notes/build'))).toBeNull()
    expect(await confirmArtifact(path.join(dir, 'py/.venv'))).toBe('virtualenv')
    expect(await confirmArtifact(path.join(dir, 'other/.venv'))).toBeNull()
    expect(await confirmArtifact(path.join(dir, 'rust/target'))).toBeNull()
  })
})

describe('terminal actions', () => {
  it('maps fixed actions and validates unit names', () => {
    expect(terminalCommand('system-update')).toBe('omarchy update')
    expect(terminalCommand('unit-status', 'foo.service')).toContain("'foo.service'")
    expect(terminalCommand('unit-status', 'foo.service', true)).toContain('systemctl --user status')
    expect(terminalCommand('unit-status', "x'; rm -rf ~; '.service")).toBeNull()
    expect(terminalCommand('unit-status', 'foo')).toBeNull()
    expect(terminalCommand('unit-status')).toBeNull()
  })
})

describe('theme', () => {
  it('parses colors.toml lines', () => {
    expect(parseColorsToml('mode = "dark"\n# c\naccent = "#96D8D8"\nbackground = #001425 # trailing\n[table]\n')).toEqual({ mode: 'dark', accent: '#96D8D8', background: '#001425' })
  })
  it('builds role variables and picks readable text on accent', () => {
    const { mode, vars } = buildPalette({ accent: '#dcd7ba', background: '#1f1f28', foreground: '#dcd7ba', red: '#c34043' })
    expect(mode).toBe('dark')
    expect(vars['--om-urgent']).toBe('#c34043')
    expect(vars['--om-on-accent']).toBe('#1f1f28')
    expect(contrast(vars['--om-on-accent'], vars['--om-accent'])).toBeGreaterThan(4.5)
  })
  it('detects light themes by luminance when mode is missing', () => {
    expect(buildPalette({ background: '#eff1f5', foreground: '#4c4f69' }).mode).toBe('light')
    expect(buildPalette({ background: '#eff1f5' }, 'dark').mode).toBe('dark')
  })
})

describe('scoring', () => {
  const base: ScanInputs = {
    disk: { mount: '/', size: 100, used: 50, avail: 50 },
    memory: { total: 100, available: 60, swapTotal: 0, swapFree: 0 },
    failedUnits: 0,
    clean: [],
    packages: { installed: 1, explicit: 1, foreign: [], orphans: [], updates: [], pacnew: [], largest: [], cacheBytes: 0, aurHelper: null },
    omarchy: null
  }
  it('scores a healthy system 100', () => {
    const result = scoreSystem({ ...base, omarchy: { present: true, version: '4', channel: 'stable', update: [], theme: 't', font: 'f', hyprland: { version: '1', configErrors: [], monitors: [] }, backups: [], snapshots: { count: null, latest: null }, plugins: [], hooks: [] } })
    expect(result.score).toBe(100)
    expect(result.grade).toBe('Excellent')
    expect(result.recommendations).toEqual([])
  })
  it('penalises a full disk, failures and pacnew files, worst first', () => {
    const result = scoreSystem({
      ...base,
      disk: { mount: '/', size: 100, used: 95, avail: 5 },
      failedUnits: 2,
      packages: { ...base.packages!, pacnew: ['/etc/pacman.conf.pacnew'] }
    })
    expect(result.score).toBe(100 - 25 - 10 - 5)
    expect(result.recommendations[0].status).toBe('critical')
    expect(result.skipped).toContain('omarchy')
  })
  it('offers low-risk cleanup as the only auto action', () => {
    const result = scoreSystem({
      ...base,
      clean: [
        { id: 'pacman-cache', label: 'Pacman cache', description: '', risk: 'low', privileged: true, bytes: 2 * 1024 ** 3, items: 3, available: true, defaultSelected: true },
        { id: 'trash', label: 'Trash', description: '', risk: 'review', privileged: false, bytes: 9 * 1024 ** 3, items: 1, available: true, defaultSelected: false }
      ]
    })
    const auto = result.recommendations.filter((rec) => rec.auto)
    expect(auto).toHaveLength(1)
    expect(auto[0].action).toEqual({ kind: 'clean', ids: ['pacman-cache'] })
    expect(result.cleanableBytes).toBe(11 * 1024 ** 3)
    expect(result.score).toBe(95)
  })
  it('grades', () => {
    expect([gradeFor(95), gradeFor(70), gradeFor(50), gradeFor(10)]).toEqual(['Excellent', 'Good', 'Fair', 'Poor'])
  })
})

describe('clearContents', () => {
  it('empties a directory, keeps it, and unlinks symlinks without following them', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'omamole-clear-'))
    const cache = path.join(sandbox, 'cache')
    const precious = path.join(sandbox, 'precious')
    await mkdir(path.join(cache, 'nested'), { recursive: true })
    await mkdir(precious)
    await writeFile(path.join(cache, 'nested/blob'), 'x')
    await writeFile(path.join(precious, 'keep.txt'), 'keep')
    await symlink(precious, path.join(cache, 'link-to-precious'))

    const outcome = await clearContents(cache, [sandbox])
    expect(outcome.ok).toBe(true)
    expect(await readdir(cache)).toEqual([])
    await expect(access(path.join(precious, 'keep.txt'))).resolves.toBeUndefined()
    await rm(sandbox, { recursive: true, force: true })
  })
  it('refuses to clear outside the allowed roots', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'omamole-clear-'))
    await writeFile(path.join(sandbox, 'f'), 'x')
    const outcome = await clearContents(sandbox, ['/nonexistent-root'])
    expect(outcome.ok).toBe(false)
    expect(await readdir(sandbox)).toEqual(['f'])
    await rm(sandbox, { recursive: true, force: true })
  })
})
