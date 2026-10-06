import { useState } from 'react'
import type { Settings, UpdateInfo } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { ErrorRow, Glyph, Skeleton } from '../components/ui'
import { useApp, useKeys } from '../lib/app-context'
import { ago, tildify } from '../lib/format'
import { G } from '../lib/glyphs'
import { useLoad, type Loaded } from '../lib/use-load'

const JOURNAL_SIZES = ['100M', '200M', '500M', '1G', '2G']
const DEV_AGES = [0, 30, 90, 180, 365]

const cycle = <T,>(values: T[], current: T, step: number): T => {
  const index = values.indexOf(current)
  return values[(Math.max(0, index) + step + values.length) % values.length]
}

/* Every setting is a row: Enter / l steps forward, h steps back, x removes a
   list entry. Saved on each change, validated again by the main process. */
export function SettingsView({ onSaved, update }: { onSaved: (settings: Settings) => void; update: Loaded<UpdateInfo> }) {
  const app = useApp()
  const loaded = useLoad(() => app.bridge.settings(), [])
  const [cursor, setCursor] = useState(0)
  const home = app.info?.home ?? null
  const settings = loaded.data

  const save = async (next: Settings) => {
    try {
      const saved = await app.bridge.saveSettings(next)
      onSaved(saved)
      loaded.reload()
      app.setStatus('Settings saved')
    } catch (error) {
      app.toast('Could not save settings', error instanceof Error ? error.message : String(error), 'urgent')
    }
  }

  const pickInto = async (apply: (path: string, current: Settings) => Settings) => {
    if (!settings) return
    const chosen = await app.bridge.pickFolder()
    if (chosen) await save(apply(home && chosen.startsWith(home) ? '~' + chosen.slice(home.length) : chosen, settings))
  }

  type Item = { key: string; section: string; label: string; value: string; step?: (direction: number) => void; enter?: () => void; remove?: () => void }
  const items: Item[] = settings
    ? [
        {
          key: 'update-check', section: 'Updates', label: 'Check GitHub for new releases daily',
          value: settings.updateCheck ? 'on' : 'off',
          step: () => void save({ ...settings, updateCheck: !settings.updateCheck })
        },
        {
          key: 'update-now', section: 'Updates', label: 'Check now',
          value: update.loading ? 'checking…' : update.data?.error ? update.data.error : update.data?.latest ? `latest ${update.data.latest}` : '',
          enter: () => update.reload(true)
        },
        {
          key: 'paccache', section: 'Cleanup', label: 'Package versions to keep',
          value: `${settings.paccacheKeep} (paccache -k)`,
          step: (d) => void save({ ...settings, paccacheKeep: Math.min(10, Math.max(0, settings.paccacheKeep + d)) })
        },
        {
          key: 'journal', section: 'Cleanup', label: 'Journal size limit',
          value: settings.journalMaxSize,
          step: (d) => void save({ ...settings, journalMaxSize: cycle(JOURNAL_SIZES, settings.journalMaxSize, d) })
        },
        {
          key: 'disk-root', section: 'Disk', label: 'Start disk analysis in',
          value: tildify(settings.diskRoot, home),
          enter: () => void pickInto((path, current) => ({ ...current, diskRoot: path }))
        },
        ...settings.devRoots.map((root, index) => ({
          key: `dev-root-${index}`, section: 'Developer artifacts', label: index === 0 ? 'Scan folder' : `Scan folder ${index + 1}`,
          value: tildify(root, home),
          enter: () => void pickInto((path, current) => ({ ...current, devRoots: current.devRoots.map((entry, i) => (i === index ? path : entry)) })),
          remove: settings.devRoots.length > 1 ? () => void save({ ...settings, devRoots: settings.devRoots.filter((_, i) => i !== index) }) : undefined
        })),
        {
          key: 'dev-root-add', section: 'Developer artifacts', label: 'Add a scan folder', value: '',
          enter: () => void pickInto((path, current) => ({ ...current, devRoots: [...current.devRoots, path] }))
        },
        {
          key: 'dev-age', section: 'Developer artifacts', label: 'Default age filter',
          value: settings.devOlderThanDays === 0 ? 'any age' : `${settings.devOlderThanDays} days+`,
          step: (d) => void save({ ...settings, devOlderThanDays: cycle(DEV_AGES, settings.devOlderThanDays, d) })
        },
        ...settings.excludePaths.map((path, index) => ({
          key: `exclude-${index}`, section: 'Excluded from scans', label: tildify(path, home), value: '',
          remove: () => void save({ ...settings, excludePaths: settings.excludePaths.filter((_, i) => i !== index) })
        })),
        {
          key: 'exclude-add', section: 'Excluded from scans', label: 'Exclude a folder', value: '',
          enter: () => void pickInto((path, current) => ({ ...current, excludePaths: [...current.excludePaths, path] }))
        }
      ]
    : []

  useKeys((event) => {
    const item = items[cursor]
    if (!item) return false
    if ((event.key === 'l' || event.key === 'ArrowRight' || event.key === '+') && item.step) {
      item.step(1)
      return true
    }
    if ((event.key === 'h' || event.key === 'ArrowLeft' || event.key === '-') && item.step) {
      item.step(-1)
      return true
    }
    if ((event.key === 'x' || event.key === 'Delete') && item.remove) {
      item.remove()
      return true
    }
    return false
  }, app.active)

  if (!settings) {
    return <div className="content">{loaded.error ? <ErrorRow message={loaded.error} /> : <Skeleton />}</div>
  }

  const rows: RowDef[] = items.map((item) => ({
    key: item.key,
    section: item.section,
    onEnter: item.enter ?? (item.step ? () => item.step?.(1) : undefined),
    content: (
      <>
        <span className="label">{item.label}</span>
        {item.value && <span className="trail strong">{item.value}</span>}
        {item.step && <span className="trail"><kbd>h</kbd> <kbd>l</kbd></span>}
        {item.enter && <Glyph g={item.key.endsWith('-add') ? G.folder : G.arrow} className="dim" />}
        {item.remove && <span className="trail"><kbd>x</kbd></span>}
      </>
    )
  }))

  return (
    <>
      <div className="content">
        <List rows={rows} cursor={cursor} setCursor={setCursor} />
      </div>
      <aside className="inspector">
        <h2>About</h2>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{app.info?.version}</dd>
          <dt>Latest</dt>
          <dd>{update.data?.latest ?? '—'}{update.data?.checkedAt ? ` · ${ago(update.data.checkedAt)}` : ''}</dd>
          <dt>Install</dt>
          <dd>{update.data?.installable ? 'package (/usr/lib/omamole)' : 'source checkout'}</dd>
          <dt>Electron</dt>
          <dd>{app.info?.electron}</dd>
          <dt>Omarchy</dt>
          <dd>{app.info?.omarchy ? 'detected' : 'not found'}</dd>
          <dt>Settings</dt>
          <dd title="~/.config/omamole/settings.json">~/.config/omamole/settings.json</dd>
          <dt>Root helper</dt>
          <dd title={app.info?.helperPath}>{app.info?.helperPath}</dd>
        </dl>
        <p style={{ marginTop: 14 }} className="dim">
          Root actions (pacman cache, journal, crash dumps) run through the helper with pkexec, so your polkit agent asks for the password once per clean. Updates and package removal run in an Omarchy terminal.
        </p>
      </aside>
    </>
  )
}
