import { useMemo, useState } from 'react'
import type { OmarchyReport, TerminalActionId } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { Badge, Button, Empty, ErrorRow, Glyph, Skeleton, Spinner, StatusMark, Tile } from '../components/ui'
import { useApp, useKeys } from '../lib/app-context'
import { age, bytes, tildify } from '../lib/format'
import { G } from '../lib/glyphs'
import type { Loaded } from '../lib/use-load'

export function Omarchy({ report, onChanged }: { report: Loaded<OmarchyReport>; onChanged: () => void }) {
  const app = useApp()
  const home = app.info?.home ?? null
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const data = report.data

  const terminal = async (action: TerminalActionId) => {
    const result = await app.bridge.terminal(action)
    app.toast(result.message, undefined, result.ok ? 'normal' : 'urgent')
  }

  const backups = data?.backups ?? []
  const chosen = useMemo(() => backups.filter((backup) => selected.has(backup.path)), [backups, selected])

  const trashSelected = async () => {
    if (chosen.length === 0) {
      app.toast('No backups selected', 'Space selects a backup, a selects all of them.')
      return
    }
    const ok = await app.confirm({
      title: `Move ${chosen.length} backup${chosen.length === 1 ? '' : 's'} to trash?`,
      glyph: G.trash,
      danger: true,
      confirmLabel: 'Move to trash',
      body: (
        <div className="preview-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {chosen.map((backup) => (
            <div className="row" key={backup.path}>
              <span className="label">{tildify(backup.path, home)}</span>
              <span className="trail">{age(backup.mtimeMs)}</span>
            </div>
          ))}
        </div>
      )
    })
    if (!ok) return
    const results = await app.bridge.trash(chosen.map((backup) => backup.path))
    const failed = results.filter((result) => !result.ok)
    app.toast(failed.length ? `${failed.length} could not be trashed` : `Moved ${results.length} backup(s) to trash`, failed[0]?.message, failed.length ? 'urgent' : 'normal')
    setSelected(new Set())
    report.reload(true)
    onChanged()
  }

  useKeys((event) => {
    if (event.key === 'u') {
      void terminal('system-update')
      return true
    }
    if (event.key === 's') {
      void terminal('snapshot')
      return true
    }
    if (event.key === 'D') {
      void terminal('debug')
      return true
    }
    if (event.key === 't') {
      void trashSelected()
      return true
    }
    if (event.key === 'a') {
      setSelected((previous) => (previous.size === backups.length ? new Set() : new Set(backups.map((backup) => backup.path))))
      return true
    }
    return false
  }, app.active)

  if (!data) {
    return <div className="content">{report.error ? <ErrorRow message={report.error} onRetry={() => report.reload(true)} /> : <Skeleton lines={12} />}</div>
  }

  if (!data.present && !data.hyprland) {
    return (
      <div className="content">
        <Empty glyph={G.omarchy}>Omarchy was not found on this system. Cleanup, disk and package tools still work.</Empty>
      </div>
    )
  }

  const rows: RowDef[] = []
  const hypr = data.hyprland

  if (hypr) {
    if (hypr.configErrors.length === 0) {
      rows.push({
        key: 'hypr-ok', section: 'Hyprland config', sectionCount: 0,
        content: (
          <>
            <StatusMark status="good" />
            <span className="label">No config errors</span>
          </>
        )
      })
    }
    hypr.configErrors.forEach((error, index) => {
      rows.push({
        key: `hypr-error-${index}`,
        section: 'Hyprland config',
        sectionCount: hypr.configErrors.length,
        className: 'tall',
        content: (
          <>
            <StatusMark status="critical" />
            <span className="label">{error}</span>
          </>
        )
      })
    })
    for (const monitor of hypr.monitors) {
      rows.push({
        key: `monitor-${monitor.name}`,
        section: 'Monitors',
        sectionCount: hypr.monitors.length,
        content: (
          <>
            <Glyph g={G.monitor} className="dim" />
            <span className="label">{monitor.name}<span className="sub">{monitor.description}</span></span>
            <span className="trail">{monitor.width}×{monitor.height} @ {monitor.refresh} Hz · ×{monitor.scale}</span>
          </>
        )
      })
    }
  }

  if (backups.length === 0) {
    rows.push({
      key: 'backups-none', section: 'Config backups', sectionCount: 0,
      content: (
        <>
          <StatusMark status="good" />
          <span className="label">No *.bak.* files in ~/.config</span>
        </>
      )
    })
  }
  for (const backup of backups) {
    const on = selected.has(backup.path)
    rows.push({
      key: `backup-${backup.path}`,
      section: 'Config backups',
      sectionCount: backups.length,
      onSpace: () =>
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(backup.path)) next.delete(backup.path)
          else next.add(backup.path)
          return next
        }),
      onEnter: () => void app.bridge.reveal(backup.path),
      title: backup.path,
      content: (
        <>
          <Glyph g={on ? G.check : G.unchecked} className={`check ${on ? 'on' : ''}`} />
          <span className="label">{tildify(backup.path, home)}</span>
          <span className="trail" style={{ minWidth: 44, textAlign: 'right' }}>{age(backup.mtimeMs)}</span>
          <span className="trail" style={{ minWidth: 64, textAlign: 'right' }}>{bytes(backup.bytes)}</span>
        </>
      )
    })
  }

  for (const plugin of data.plugins) {
    rows.push({
      key: `plugin-${plugin}`,
      section: 'Shell plugins',
      sectionCount: data.plugins.length,
      content: (
        <>
          <Glyph g={G.plug} className="dim" />
          <span className="label">{plugin}</span>
          {plugin.startsWith('.') && <Badge tone="urgent">hidden copy</Badge>}
        </>
      )
    })
  }
  for (const hook of data.hooks) {
    rows.push({
      key: `hook-${hook}`,
      section: 'Active hooks',
      sectionCount: data.hooks.length,
      content: (
        <>
          <Glyph g={G.hook} className="dim" />
          <span className="label">{hook}</span>
        </>
      )
    })
  }

  return (
    <div className={`content ${report.loading ? 'stale' : ''}`}>
      <div className="controls">
        <Button variant="primary" glyph={G.update} kbd="u" onClick={() => terminal('system-update')}>
          {data.update && data.update.length > 0 ? 'Install update' : 'omarchy update'}
        </Button>
        <Button variant="bordered" glyph={G.snapshot} kbd="s" onClick={() => terminal('snapshot')}>Snapshot</Button>
        <Button variant="bordered" glyph={G.terminal} kbd="D" onClick={() => terminal('debug')}>Debug report</Button>
        <Button variant="bordered" glyph={G.trash} kbd="t" onClick={trashSelected} disabled={chosen.length === 0}>Trash {chosen.length || ''} backup{chosen.length === 1 ? '' : 's'}</Button>
        {report.loading && <Spinner />}
      </div>
      <div className="tiles">
        <Tile glyph={G.omarchy} label="Omarchy" value={data.version ?? '—'} sub={data.update && data.update.length > 0 ? data.update[0] : `${data.channel ?? 'unknown'} · up to date`} />
        <Tile text label="Theme" value={data.theme ?? '—'} sub={data.font ?? undefined} />
        <Tile label="Hyprland" value={hypr?.version ?? '—'} sub={hypr ? `${hypr.monitors.length} monitor${hypr.monitors.length === 1 ? '' : 's'}` : 'not running'} />
        <Tile glyph={G.snapshot} label="Snapshots" value={data.snapshots.count ?? '—'} sub={data.snapshots.error} />
      </div>
      <List rows={rows} cursor={cursor} setCursor={setCursor} />
    </div>
  )
}
