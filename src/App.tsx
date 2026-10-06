import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppInfo, OmamoleBridge, Settings, ThemePayload, ViewId } from '../src-electron/types'
import { Button, Glyph, Spinner } from './components/ui'
import { AppContext, isTyping, type AppApi, type ConfirmOptions, type KeyHandler, type ToastTone } from './lib/app-context'
import { ago, bytes } from './lib/format'
import { G } from './lib/glyphs'
import { useLoad } from './lib/use-load'
import { Clean } from './views/Clean'
import { Dev } from './views/Dev'
import { Disk } from './views/Disk'
import { Omarchy } from './views/Omarchy'
import { Overview } from './views/Overview'
import { Packages } from './views/Packages'
import { SettingsView } from './views/SettingsView'
import { System } from './views/System'

const VIEWS: { id: ViewId; label: string; glyph: string; title: string }[] = [
  { id: 'overview', label: 'Overview', glyph: G.overview, title: 'Health overview' },
  { id: 'clean', label: 'Clean', glyph: G.clean, title: 'System cleanup' },
  { id: 'disk', label: 'Disk', glyph: G.disk, title: 'Disk analysis' },
  { id: 'dev', label: 'Dev artifacts', glyph: G.dev, title: 'Developer artifacts' },
  { id: 'packages', label: 'Packages', glyph: G.packages, title: 'Pacman & AUR' },
  { id: 'system', label: 'System', glyph: G.system, title: 'Processes & services' },
  { id: 'omarchy', label: 'Omarchy', glyph: G.omarchy, title: 'Omarchy & Hyprland' },
  { id: 'settings', label: 'Settings', glyph: G.settings, title: 'Settings' }
]

type Toast = { id: number; message: string; detail?: string; tone: ToastTone }

const ZOOM_KEY = 'omamole.zoom'

const readZoom = () => {
  try {
    const value = Number(localStorage.getItem(ZOOM_KEY))
    return value >= 0.7 && value <= 1.8 ? value : 1
  } catch {
    return 1
  }
}

function applyTheme(theme: ThemePayload) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value)
  root.style.setProperty('--om-font', `"${theme.font.replace(/"/g, '')}", "JetBrainsMono Nerd Font", ui-monospace, monospace`)
  root.style.setProperty('--om-radius', `${theme.radius}px`)
  root.dataset.mode = theme.mode
  root.style.colorScheme = theme.mode
}

export function App({ bridge: rawBridge }: { bridge: OmamoleBridge }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [theme, setTheme] = useState<ThemePayload | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<ViewId>('overview')
  const [focus, setFocus] = useState<'nav' | 'content'>('content')
  const [status, setStatus] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)
  const [help, setHelp] = useState(false)
  const [zoom, setZoom] = useState(readZoom)
  const handlers = useRef<{ current: KeyHandler }[]>([])
  const viewRefresh = useRef<{ current: () => void } | null>(null)
  /* Set when work was handed to a terminal (an update, an orphan review), so
     coming back to the window refreshes from the system, not the cache. */
  const dirty = useRef(false)

  const bridge = useMemo<OmamoleBridge>(() => ({
    ...rawBridge,
    terminal: async (...args) => {
      const result = await rawBridge.terminal(...args)
      if (result.ok) dirty.current = true
      return result
    }
  }), [rawBridge])

  const scan = useLoad((force) => bridge.scan(force), [])
  const packages = useLoad((force) => bridge.packages(force), [])
  const omarchy = useLoad((force) => bridge.omarchy(force), [])
  const update = useLoad((force) => bridge.update(force), [])

  useEffect(() => {
    bridge.app().then(setInfo).catch(() => {})
    bridge.settings().then(setSettings).catch(() => {})
    bridge.theme().then((value) => {
      applyTheme(value)
      setTheme(value)
    }).catch(() => {})
    const offTheme = bridge.onTheme((value) => {
      applyTheme(value)
      setTheme(value)
    })
    const offFocus = bridge.onFocus(() => {
      if (!dirty.current) return
      dirty.current = false
      scan.reload(true)
      packages.reload(true)
      omarchy.reload(true)
      update.reload(false)
    })
    return () => {
      offTheme()
      offFocus()
    }
  }, [bridge, scan.reload, packages.reload, omarchy.reload, update.reload])

  useEffect(() => {
    document.documentElement.style.setProperty('zoom', String(zoom))
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom))
    } catch {
      /* storage unavailable: zoom just isn't remembered */
    }
  }, [zoom])

  const toast = useCallback((message: string, detail?: string, tone: ToastTone = 'normal') => {
    const id = Date.now() + Math.random()
    setToasts((previous) => [...previous.slice(-3), { id, message, detail, tone }])
    setTimeout(() => setToasts((previous) => previous.filter((entry) => entry.id !== id)), tone === 'urgent' ? 9000 : 5000)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ options, resolve })), [])

  const closeDialog = (ok: boolean) => {
    dialog?.resolve(ok)
    setDialog(null)
  }

  const go = useCallback((next: ViewId) => {
    setView(next)
    setFocus('content')
  }, [])

  const registerKeys = useCallback((handler: { current: KeyHandler }) => {
    handlers.current.push(handler)
    return () => {
      handlers.current = handlers.current.filter((entry) => entry !== handler)
    }
  }, [])

  const registerRefresh = useCallback((refresh: { current: () => void }) => {
    viewRefresh.current = refresh
    return () => {
      if (viewRefresh.current === refresh) viewRefresh.current = null
    }
  }, [])

  /* U: restart into an installed update, or install the available one. */
  const runUpdate = useCallback(async () => {
    const info = update.data
    if (info?.restartNeeded) {
      await bridge.restart()
      return
    }
    if (!info?.available) {
      toast('OmaMole is up to date', info?.latest ? `Latest release is ${info.latest}.` : undefined)
      return
    }
    const result = await bridge.terminal('self-update')
    toast(result.ok ? `Installing OmaMole ${info.latest}` : result.message, result.ok ? 'Follow the terminal; restart OmaMole when it finishes.' : undefined, result.ok ? 'normal' : 'urgent')
  }, [bridge, toast, update.data])

  const refreshCurrent = useCallback(() => {
    if (viewRefresh.current) viewRefresh.current.current()
    else if (view === 'overview') scan.reload(true)
    else if (view === 'packages') packages.reload(true)
    else if (view === 'omarchy') omarchy.reload(true)
  }, [view, scan.reload, packages.reload, omarchy.reload])

  const api: AppApi = useMemo(() => ({
    bridge,
    info,
    active: focus === 'content' && !dialog && !help,
    go,
    focusNav: () => setFocus('nav'),
    toast,
    confirm,
    setStatus,
    runUpdate,
    registerKeys,
    registerRefresh
  }), [bridge, info, focus, dialog, help, go, toast, confirm, runUpdate, registerKeys, registerRefresh])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog) {
        if (event.key === 'Enter' || event.key === 'y') closeDialog(true)
        else if (event.key === 'Escape' || event.key === 'n' || event.key === 'q') closeDialog(false)
        event.preventDefault()
        return
      }
      if (help) {
        if (event.key === 'Escape' || event.key === '?' || event.key === 'q') setHelp(false)
        event.preventDefault()
        return
      }
      if (isTyping(event)) return

      if (event.ctrlKey) {
        if (event.key === '=' || event.key === '+') setZoom((value) => Math.min(1.8, Math.round((value + 0.1) * 10) / 10))
        else if (event.key === '-') setZoom((value) => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))
        else if (event.key === '0') setZoom(1)
        else return
        event.preventDefault()
        return
      }
      if (event.altKey || event.metaKey) return

      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= VIEWS.length) {
        go(VIEWS[digit - 1].id)
        event.preventDefault()
        return
      }
      if (event.key === 'U') {
        void runUpdate()
        event.preventDefault()
        return
      }
      if (event.key === '?') {
        setHelp(true)
        event.preventDefault()
        return
      }
      if (event.key === 'Tab') {
        setFocus((value) => (value === 'nav' ? 'content' : 'nav'))
        event.preventDefault()
        return
      }

      if (focus === 'content') {
        for (let i = handlers.current.length - 1; i >= 0; i -= 1) {
          if (handlers.current[i].current(event)) {
            event.preventDefault()
            return
          }
        }
        if (event.key === 'Escape' || event.key === 'h' || event.key === 'ArrowLeft') {
          setFocus('nav')
          event.preventDefault()
        } else if (event.key === 'r') {
          refreshCurrent()
          event.preventDefault()
        }
        return
      }

      const index = VIEWS.findIndex((entry) => entry.id === view)
      if (event.key === 'j' || event.key === 'ArrowDown') setView(VIEWS[Math.min(VIEWS.length - 1, index + 1)].id)
      else if (event.key === 'k' || event.key === 'ArrowUp') setView(VIEWS[Math.max(0, index - 1)].id)
      else if (event.key === 'g') setView(VIEWS[0].id)
      else if (event.key === 'G') setView(VIEWS[VIEWS.length - 1].id)
      else if (event.key === 'Enter' || event.key === 'l' || event.key === 'ArrowRight') setFocus('content')
      else if (event.key === 'r') refreshCurrent()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const current = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0]
  const navTrail = (id: ViewId): ReactNode => {
    const data = scan.data
    if (!data) return null
    if (id === 'overview') return data.score
    if (id === 'clean') return data.cleanableBytes > 0 ? bytes(data.cleanableBytes).replace(' ', '') : null
    if (id === 'packages') return data.pendingUpdates ? <span className="status info">{data.pendingUpdates}</span> : null
    if (id === 'system') return data.failedUnits ? <span className="status critical">{data.failedUnits}</span> : null
    if (id === 'omarchy') {
      const errors = omarchy.data?.hyprland?.configErrors.length ?? 0
      return errors ? <span className="status critical">{errors}</span> : omarchy.data?.update?.length ? <Glyph g={G.update} className="status info" /> : null
    }
    return null
  }

  const loadingAny = scan.loading || packages.loading || omarchy.loading

  let body: ReactNode
  switch (view) {
    case 'overview':
      body = <Overview scan={scan} />
      break
    case 'clean':
      body = <Clean onCleaned={() => scan.reload(true)} />
      break
    case 'disk':
      body = settings ? <Disk initialRoot={settings.diskRoot.replace(/^~/, info?.home ?? '~')} /> : null
      break
    case 'dev':
      body = settings ? <Dev initialRoot={settings.devRoots[0].replace(/^~/, info?.home ?? '~')} initialDays={settings.devOlderThanDays} /> : null
      break
    case 'packages':
      body = <Packages report={packages} />
      break
    case 'system':
      body = <System />
      break
    case 'omarchy':
      body = <Omarchy report={omarchy} onChanged={() => scan.reload(true)} />
      break
    case 'settings':
      body = <SettingsView onSaved={(saved) => {
        setSettings(saved)
        update.reload(false)
      }} update={update} />
      break
  }

  return (
    <AppContext.Provider value={api}>
      <div className="app">
        <header className="toolbar">
          <span className="app-name">
            <Glyph g={G.mole} />
            OmaMole
          </span>
          <span className="crumb">/ {current.title}</span>
          <span className="spacer" />
          {loadingAny && <Spinner />}
          {scan.data && <span className="dim">scanned {ago(scan.data.generatedAt)}</span>}
          {update.data?.restartNeeded ? (
            <Button small variant="primary" glyph={G.refresh} kbd="U" onClick={runUpdate} title={`OmaMole ${update.data.installedVersion} is installed`}>Restart to update</Button>
          ) : update.data?.available ? (
            <Button small variant="primary" glyph={G.update} kbd="U" onClick={runUpdate} title={update.data.installable ? 'Build and install in a terminal' : 'Running from source: git pull'}>v{update.data.latest}</Button>
          ) : null}
          <Button small glyph={G.refresh} kbd="r" onClick={refreshCurrent} title="Refresh this view">Refresh</Button>
          <Button small glyph={G.help} kbd="?" onClick={() => setHelp(true)} title="Keyboard shortcuts">Keys</Button>
        </header>

        <nav className={`nav list ${focus === 'nav' ? '' : 'inactive'}`}>
          <div className="section-header"><span>Views</span><span className="rule" /></div>
          {VIEWS.map((entry, index) => (
            <div
              key={entry.id}
              className={`row ${entry.id === view ? 'current' : ''} ${entry.id === view && focus === 'nav' ? 'cursor' : ''}`}
              onClick={() => go(entry.id)}
              title={`${entry.label} (${index + 1})`}
            >
              <span className="num">{index + 1}</span>
              <Glyph g={entry.glyph} />
              <span className="label">{entry.label}</span>
              <span className="trail">{navTrail(entry.id)}</span>
            </div>
          ))}
          <div className="nav-foot">
            {theme ? `${theme.name} · ${theme.font}` : ''}
          </div>
        </nav>

        <main className="main" key={view}>{body}</main>

        <footer className="statusbar">
          <span className="message">{status || (scan.data ? `Health ${scan.data.score}/100 · ${scan.data.grade}` : 'Scanning…')}</span>
          <span className="spacer" />
          <span className="hints">
            <kbd>1-8</kbd> views · <kbd>tab</kbd> {focus === 'nav' ? 'content' : 'nav'} · <kbd>j</kbd><kbd>k</kbd> move · <kbd>enter</kbd> act · <kbd>?</kbd> keys
          </span>
          {zoom !== 1 && <span>{Math.round(zoom * 100)}%</span>}
        </footer>
      </div>

      {dialog && (
        <div className="scrim" onClick={() => closeDialog(false)}>
          <div className={`dialog ${dialog.options.danger ? 'danger' : ''}`} role="alertdialog" onClick={(event) => event.stopPropagation()}>
            <h2>
              {dialog.options.glyph && <Glyph g={dialog.options.glyph} />}
              {dialog.options.title}
            </h2>
            <div className="body">{dialog.options.body}</div>
            <div className="actions">
              <Button kbd="esc" onClick={() => closeDialog(false)}>Cancel</Button>
              <Button variant={dialog.options.danger ? 'urgent' : 'primary'} kbd="enter" onClick={() => closeDialog(true)}>
                {dialog.options.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}

      {help && (
        <div className="scrim" onClick={() => setHelp(false)}>
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <h2><Glyph g={G.keyboard} /> Keyboard</h2>
            <div className="help-grid">
              <kbd>1 – 8</kbd><span>jump to a view</span>
              <kbd>tab</kbd><span>switch between the view list and the content</span>
              <kbd>j / k</kbd><span>move the cursor (arrows work too)</span>
              <kbd>g / G</kbd><span>first / last row</span>
              <kbd>enter</kbd><span>act on the row: open, drill in, run in a terminal</span>
              <kbd>space</kbd><span>select a row for a batch action</span>
              <kbd>h / esc</kbd><span>back to the view list (in Disk: up a folder)</span>
              <kbd>r</kbd><span>refresh, bypassing the cache</span>
              <kbd>U</kbd><span>install an OmaMole update, or restart into one</span>
              <kbd>ctrl + / −</kbd><span>zoom · ctrl 0 resets</span>
              <kbd>super w</kbd><span>close (Hyprland)</span>
            </div>
            <div className="dim">Each view shows its own keys under the list. Nothing is deleted without a confirmation that lists what goes.</div>
          </div>
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((entry) => (
          <div key={entry.id} className={`toast ${entry.tone === 'urgent' ? 'urgent' : ''}`}>
            <Glyph g={entry.tone === 'urgent' ? G.critical : G.good} className={`status ${entry.tone === 'urgent' ? 'critical' : 'info'}`} />
            <div className="toast-body">
              <div>{entry.message}</div>
              {entry.detail && <div className="toast-detail">{entry.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}
