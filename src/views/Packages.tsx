import { useState } from 'react'
import type { PackagesReport, TerminalActionId } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { Badge, Button, ErrorRow, Glyph, Skeleton, Spinner, StatusMark, Tile, Track } from '../components/ui'
import { useApp, useKeys } from '../lib/app-context'
import { bytes, percent } from '../lib/format'
import { G } from '../lib/glyphs'
import type { Loaded } from '../lib/use-load'

export function Packages({ report }: { report: Loaded<PackagesReport> }) {
  const app = useApp()
  const [cursor, setCursor] = useState(0)
  const data = report.data

  const terminal = async (action: TerminalActionId) => {
    const result = await app.bridge.terminal(action)
    app.toast(result.message, action === 'system-update' ? 'OmaMole rescans when you come back to it.' : undefined, result.ok ? 'normal' : 'urgent')
  }

  useKeys((event) => {
    if (event.key === 'u') {
      void terminal('system-update')
      return true
    }
    if (event.key === 'o') {
      void terminal('orphans')
      return true
    }
    if (event.key === 'p') {
      void terminal('pacdiff')
      return true
    }
    return false
  }, app.active)

  if (!data) {
    return <div className="content">{report.error ? <ErrorRow message={report.error} onRetry={() => report.reload(true)} /> : <Skeleton lines={12} />}</div>
  }

  const rows: RowDef[] = []
  if (data.updates === null) {
    rows.push({
      key: 'updates-error', section: 'Updates',
      content: (
        <>
          <StatusMark status="warning" />
          <span className="label">Could not check for updates<span className="sub">{data.updatesError}</span></span>
        </>
      )
    })
  } else if (data.updates.length === 0) {
    rows.push({
      key: 'updates-none', section: 'Updates', sectionCount: 0,
      content: (
        <>
          <StatusMark status="good" />
          <span className="label">Everything is up to date</span>
        </>
      )
    })
  } else {
    for (const update of data.updates) {
      rows.push({
        key: `update-${update.source}-${update.name}`,
        section: 'Updates',
        sectionCount: data.updates.length,
        onEnter: () => void terminal('system-update'),
        content: (
          <>
            <Glyph g={G.update} className="dim" />
            <span className="label">
              {update.name}
              <span className="sub">{update.from} → {update.to}</span>
            </span>
            {update.source === 'aur' && <Badge tone="accent">AUR</Badge>}
          </>
        )
      })
    }
  }

  for (const orphan of data.orphans) {
    rows.push({
      key: `orphan-${orphan.name}`,
      section: 'Orphans',
      sectionCount: data.orphans.length,
      onEnter: () => void terminal('orphans'),
      content: (
        <>
          <Glyph g={G.packages} className="dim" />
          <span className="label">{orphan.name}<span className="sub">{orphan.version}</span></span>
          <span className="trail">{bytes(orphan.bytes)}</span>
        </>
      )
    })
  }

  for (const file of data.pacnew) {
    rows.push({
      key: `pacnew-${file}`,
      section: 'Unmerged config',
      sectionCount: data.pacnew.length,
      onEnter: () => void terminal('pacdiff'),
      content: (
        <>
          <StatusMark status="warning" />
          <span className="label">{file}</span>
          <Badge tone="urgent">{file.endsWith('.pacnew') ? 'pacnew' : 'pacsave'}</Badge>
        </>
      )
    })
  }

  const largest = data.largest[0]?.bytes ?? 1
  for (const pkg of data.largest) {
    rows.push({
      key: `largest-${pkg.name}`,
      section: 'Largest installed',
      content: (
        <>
          <span className="label">{pkg.name}</span>
          <span className="bar-cell"><Track value={percent(pkg.bytes, largest)} /></span>
          <span className="trail strong" style={{ minWidth: 72, textAlign: 'right' }}>{bytes(pkg.bytes)}</span>
        </>
      )
    })
  }

  for (const pkg of data.foreign) {
    rows.push({
      key: `foreign-${pkg.name}`,
      section: 'Foreign (AUR / local)',
      sectionCount: data.foreign.length,
      content: (
        <>
          <span className="label">{pkg.name}<span className="sub">{pkg.version}</span></span>
        </>
      )
    })
  }

  const pending = data.updates?.length ?? 0

  return (
    <div className={`content ${report.loading ? 'stale' : ''}`}>
      <div className="controls">
        <Button variant="primary" glyph={G.update} kbd="u" onClick={() => terminal('system-update')}>
          {pending > 0 ? `Update ${pending}` : 'Update system'}
        </Button>
        <Button variant="bordered" kbd="o" onClick={() => terminal('orphans')} disabled={data.orphans.length === 0}>Review orphans</Button>
        <Button variant="bordered" kbd="p" onClick={() => terminal('pacdiff')} disabled={data.pacnew.length === 0}>Merge .pacnew</Button>
        {report.loading && <Spinner />}
      </div>
      <div className="tiles">
        <Tile glyph={G.packages} label="Installed" value={data.installed.toLocaleString()} sub={`${data.explicit} explicit`} />
        <Tile glyph={G.update} label="Updates" value={data.updates === null ? '—' : pending} sub={data.updates === null ? 'check failed' : `${data.updates.filter((update) => update.source === 'aur').length} from AUR`} />
        <Tile label="Foreign" value={data.foreign.length} sub={data.aurHelper ? `via ${data.aurHelper}` : 'no AUR helper'} />
        <Tile glyph={G.disk} label="Package cache" value={bytes(data.cacheBytes)} sub="/var/cache/pacman/pkg" />
      </div>
      <List rows={rows} cursor={cursor} setCursor={setCursor} />
      <div className="dim" style={{ marginTop: 'var(--om-panel-gap)' }}>
        Updates run through <code>omarchy update</code> in a floating terminal — it handles keyrings, migrations and snapshots that a bare pacman -Syu would skip.
      </div>
    </div>
  )
}
