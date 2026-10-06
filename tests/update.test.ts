import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { terminalCommand } from '../src-electron/terminal'
import { createUpdater, isNewer, newestTag, parseVersion, selfUpdateCommand, type UpdateDeps } from '../src-electron/update'

describe('versions', () => {
  it('parses strict x.y.z with optional v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.10.0')).toEqual([0, 10, 0])
    expect(parseVersion('v1.2.3-rc1')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
  })
  it('picks the highest tag regardless of order and ignores junk', () => {
    expect(newestTag([{ name: 'v0.9.0' }, { name: 'v0.10.0' }, { name: 'v0.2.0' }, { name: 'nightly' }, null])).toBe('0.10.0')
    expect(newestTag({ message: 'API rate limit exceeded' })).toBeNull()
  })
  it('compares', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer(null, '0.1.0')).toBe(false)
  })
})

describe('self-update command', () => {
  it('builds from the tag PKGBUILD for valid versions only', () => {
    const command = selfUpdateCommand('0.2.0')
    expect(command).toContain('https://raw.githubusercontent.com/mrelph/OmaMole/v0.2.0/packaging/PKGBUILD')
    expect(command).toContain('makepkg -si')
    expect(selfUpdateCommand("0.2.0'; rm -rf ~; '")).toBeNull()
    expect(terminalCommand('self-update', '1.0')).toBeNull()
    expect(terminalCommand('self-update')).toBeNull()
  })
})

describe('updater', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  const setup = async (overrides: Partial<UpdateDeps> & { tags?: unknown; fail?: boolean; installed?: string } = {}) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'omamole-update-'))
    dirs.push(dir)
    if (overrides.installed) await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: overrides.installed }))
    let calls = 0
    const updater = createUpdater({
      current: '0.1.0',
      appRoot: dir,
      cacheDir: path.join(dir, 'cache'),
      enabled: async () => true,
      fetchJson: async () => {
        calls += 1
        if (overrides.fail) throw new Error('offline')
        return overrides.tags ?? [{ name: 'v0.1.0' }]
      },
      ...overrides
    })
    return { updater, calls: () => calls }
  }

  it('reports a newer tag and caches the answer for a day', async () => {
    const { updater, calls } = await setup({ tags: [{ name: 'v0.1.0' }, { name: 'v0.2.0' }] })
    const first = await updater.check()
    expect(first).toMatchObject({ latest: '0.2.0', available: true, installable: false, restartNeeded: false })
    await updater.check()
    expect(calls()).toBe(1)
    await updater.check(true)
    expect(calls()).toBe(2)
  })

  it('stays quiet when up to date or disabled', async () => {
    expect((await (await setup()).updater.check()).available).toBe(false)
    const disabled = await setup({ enabled: async () => false })
    expect((await disabled.updater.check()).available).toBe(false)
    expect(disabled.calls()).toBe(0)
  })

  it('does not stamp a failed check, so the next launch asks again', async () => {
    const { updater, calls } = await setup({ fail: true })
    expect((await updater.check()).available).toBe(false)
    await updater.check()
    expect(calls()).toBe(2)
  })

  it('asks for a restart once a newer version is installed under the running app', async () => {
    const { updater } = await setup({ installed: '0.2.0', tags: [{ name: 'v0.2.0' }] })
    const info = await updater.check()
    expect(info.restartNeeded).toBe(true)
    expect(info.available).toBe(false)
  })
})
