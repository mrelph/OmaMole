import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { existsSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cached } from './exec'
import { getHelperPath, setHelperRoot } from './privileged'
import { CATEGORY_ORDER, listCategories, previewCategory, runCategories } from './probes/clean'
import { analyzeDisk } from './probes/disk'
import { removeArtifacts, scanDev } from './probes/dev'
import { omarchyReport } from './probes/omarchy'
import { packagesReport } from './probes/packages'
import { memorySummary, rootDisk, scoreSystem } from './probes/scan'
import { failedUnits, systemReport } from './probes/system'
import { deletionProblem, expandHome } from './safety'
import { loadSettings, saveSettings } from './settings'
import { launchTerminal } from './terminal'
import { resolveTheme, watchTheme } from './theme'
import { createUpdater } from './update'
import type { CleanCategoryId, DiskMode, RemoveResult, ScanReport, TerminalActionId } from './types'

/* The runtime Wayland app_id comes from package.json `name` (omamole). The
   desktop entry's StartupWMClass and any Hyprland window rule must match it. */
app.setName('omamole')
setHelperRoot(app.getAppPath())

const single = app.requestSingleInstanceLock()
if (!single) app.quit()

let win: BrowserWindow | null = null
let lastTheme = ''

/* Shared probes, cached so the overview and the detail views reuse one run.
   checkupdates touches the network; nothing should run it twice a minute. */
const getClean = cached(60_000, listCategories)
const getPackages = cached(5 * 60_000, packagesReport)
const getOmarchy = cached(60_000, omarchyReport)

/* net.fetch goes through Chromium's network stack, so a system or PAC proxy
   is honoured. */
const updater = createUpdater({
  current: app.getVersion(),
  appRoot: app.getAppPath(),
  cacheDir: app.getPath('userData'),
  enabled: async () => (await loadSettings()).updateCheck,
  fetchJson: async (url, timeoutMs) => {
    const response = await net.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `OmaMole/${app.getVersion()}` },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
    return response.json()
  }
})

async function scan(force: boolean): Promise<ScanReport> {
  const settled = <T>(promise: Promise<T>) => promise.then((value) => value, () => null)
  const [disk, memory, failed, clean, packages, omarchy, update] = await Promise.all([
    settled(rootDisk()),
    memorySummary(),
    settled(failedUnits()),
    settled(getClean(force)),
    settled(getPackages(force)),
    settled(getOmarchy(force)),
    settled(updater.check(false))
  ])
  const scored = scoreSystem({ disk, memory, failedUnits: failed?.length ?? 0, clean, packages, omarchy, update })
  return { ...scored, disk, memory, generatedAt: Date.now() }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 560,
    minHeight: 380,
    /* The compositor owns the frame: Hyprland draws the border and there is
       no title bar to drag in a tiled layout. */
    frame: false,
    show: false,
    title: 'OmaMole',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  resolveTheme().then((theme) => {
    lastTheme = JSON.stringify(theme)
    win?.setBackgroundColor(theme.vars['--om-background'] ?? '#000000')
  }).catch(() => {})

  win.once('ready-to-show', () => win?.show())
  /* `omarchy font set` and a Hyprland rounding change don't touch the theme
     directory, so re-resolve on focus and push only if something changed. */
  win.on('focus', () => {
    win?.webContents.send('app:focus')
    resolveTheme().then((theme) => {
      const serialized = JSON.stringify(theme)
      if (serialized === lastTheme) return
      lastTheme = serialized
      win?.webContents.send('theme:changed', theme)
    }).catch(() => {})
  })
  win.on('closed', () => {
    win = null
  })

  /* No navigation away from the app, ever; links open in the default browser. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

const isCategory = (value: unknown): value is CleanCategoryId => CATEGORY_ORDER.includes(value as CleanCategoryId)
const DISK_MODES: DiskMode[] = ['folders', 'files', 'types', 'old']
const TERMINAL_ACTIONS: TerminalActionId[] = ['system-update', 'orphans', 'pacdiff', 'snapshot', 'btop', 'debug', 'unit-status', 'self-update']
const stringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    omarchy: existsSync(process.env.OMARCHY_PATH || '/usr/share/omarchy'),
    helperPath: getHelperPath(),
    home: os.homedir()
  }))
  ipcMain.handle('theme:get', () => resolveTheme())
  ipcMain.handle('scan', (_event, force: unknown) => scan(force === true))

  ipcMain.handle('clean:list', (_event, force: unknown) => getClean(force === true))
  ipcMain.handle('clean:preview', (_event, id: unknown) => {
    if (!isCategory(id)) throw new Error('unknown category')
    return previewCategory(id)
  })
  ipcMain.handle('clean:run', async (_event, ids: unknown) => {
    const valid = stringArray(ids).filter(isCategory)
    const results = await runCategories(valid, { trashItem: (target) => shell.trashItem(target) })
    getClean(true).catch(() => {})
    return results
  })

  ipcMain.handle('disk', async (_event, root: unknown, mode: unknown, limit: unknown) => {
    const settings = await loadSettings()
    const safeMode = DISK_MODES.includes(mode as DiskMode) ? (mode as DiskMode) : 'folders'
    return analyzeDisk(typeof root === 'string' ? root : settings.diskRoot, safeMode, typeof limit === 'number' ? limit : 50, settings.excludePaths)
  })

  ipcMain.handle('dev:scan', async (_event, root: unknown, olderThanDays: unknown) => {
    const settings = await loadSettings()
    const days = typeof olderThanDays === 'number' && olderThanDays >= 0 ? Math.floor(olderThanDays) : settings.devOlderThanDays
    return scanDev(typeof root === 'string' ? root : settings.devRoots[0], days, settings.excludePaths)
  })
  ipcMain.handle('dev:remove', (_event, paths: unknown) => removeArtifacts(stringArray(paths)))

  ipcMain.handle('packages', (_event, force: unknown) => getPackages(force === true))
  ipcMain.handle('system', () => systemReport())
  ipcMain.handle('omarchy', (_event, force: unknown) => getOmarchy(force === true))

  ipcMain.handle('terminal', async (_event, action: unknown, arg: unknown, userScope: unknown) => {
    if (!TERMINAL_ACTIONS.includes(action as TerminalActionId)) return { ok: false, message: 'Unknown action' }
    /* The version to install comes from main's own check, never from the
       renderer. */
    if (action === 'self-update') {
      const info = await updater.check(false)
      if (!info.installable) return { ok: false, message: 'Running from source: update with git pull and pnpm build' }
      if (!info.available || !info.latest) return { ok: false, message: 'OmaMole is up to date' }
      return launchTerminal('self-update', info.latest)
    }
    return launchTerminal(action as TerminalActionId, typeof arg === 'string' ? arg : undefined, userScope === true)
  })

  ipcMain.handle('reveal', async (_event, target: unknown) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return
    shell.showItemInFolder(target)
  })

  /* Trash is for review items (config backups, single files from the disk
     view). Same shape rules as deletion: inside home, not protected. */
  ipcMain.handle('trash', async (_event, paths: unknown) => {
    const results: RemoveResult[] = []
    for (const target of stringArray(paths).slice(0, 500)) {
      const problem = deletionProblem(target, [os.homedir()])
      if (problem) {
        results.push({ path: target, ok: false, bytes: 0, message: problem })
        continue
      }
      try {
        const { size } = await lstat(target)
        await shell.trashItem(target)
        results.push({ path: target, ok: true, bytes: size })
      } catch (error) {
        results.push({ path: target, ok: false, bytes: 0, message: error instanceof Error ? error.message : String(error) })
      }
    }
    getClean(true).catch(() => {})
    getOmarchy(true).catch(() => {})
    return results
  })

  ipcMain.handle('pick-folder', async (_event, start: unknown) => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: typeof start === 'string' ? expandHome(start) : os.homedir()
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('update', (_event, force: unknown) => updater.check(force === true))
  ipcMain.handle('restart', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_event, next: unknown) => {
    const saved = await saveSettings(next)
    getClean(true).catch(() => {})
    return saved
  })
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  watchTheme((theme) => {
    lastTheme = JSON.stringify(theme)
    win?.setBackgroundColor(theme.vars['--om-background'] ?? '#000000')
    win?.webContents.send('theme:changed', theme)
  })
})

app.on('window-all-closed', () => app.quit())
