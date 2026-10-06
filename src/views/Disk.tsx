import { useEffect, useState } from 'react'
import type { DiskMode } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { Button, ButtonGroup, Empty, ErrorRow, Glyph, Meter, Skeleton, Spinner, Track } from '../components/ui'
import { useApp, useKeys, useRefresh } from '../lib/app-context'
import { age, bytes, percent, tildify } from '../lib/format'
import { G } from '../lib/glyphs'
import { useLoad } from '../lib/use-load'

const MODES: { value: DiskMode; label: string }[] = [
  { value: 'folders', label: 'Folders' },
  { value: 'files', label: 'Largest files' },
  { value: 'types', label: 'By type' },
  { value: 'old', label: 'Old files' }
]

export function Disk({ initialRoot }: { initialRoot: string }) {
  const app = useApp()
  const home = app.info?.home ?? null
  const [root, setRoot] = useState(initialRoot)
  const [mode, setMode] = useState<DiskMode>('folders')
  const [cursor, setCursor] = useState(0)
  /* Where we came from, so h / Backspace climbs back to the folder the
     cursor was on rather than the top of the parent. */
  const [trail, setTrail] = useState<{ root: string; cursor: number }[]>([])
  const report = useLoad(() => app.bridge.disk(root, mode, 60), [root, mode])
  useRefresh(() => report.reload(true))

  useEffect(() => setRoot(initialRoot), [initialRoot])

  const enter = (path: string) => {
    setTrail((previous) => [...previous, { root, cursor }])
    setRoot(path)
    setCursor(0)
  }

  const up = () => {
    const last = trail[trail.length - 1]
    if (last) {
      setTrail((previous) => previous.slice(0, -1))
      setRoot(last.root)
      setCursor(last.cursor)
      return
    }
    const parent = root.replace(/\/[^/]+\/?$/, '') || '/'
    if (parent !== root) {
      setRoot(parent)
      setCursor(0)
    }
  }

  const pick = async () => {
    const chosen = await app.bridge.pickFolder(root)
    if (chosen) {
      setTrail([])
      setRoot(chosen)
      setCursor(0)
    }
  }

  const trashEntry = async (path: string, size: number) => {
    const ok = await app.confirm({
      title: 'Move to trash?',
      glyph: G.trash,
      danger: true,
      confirmLabel: `Trash ${bytes(size)}`,
      body: <div className="code">{tildify(path, home)}</div>
    })
    if (!ok) return
    const [result] = await app.bridge.trash([path])
    if (result?.ok) {
      app.toast('Moved to trash', tildify(path, home))
      report.reload(true)
    } else {
      app.toast('Could not trash', result?.message ?? 'unknown error', 'urgent')
    }
  }

  const data = report.data
  const entries = data?.entries ?? []
  const max = entries[0]?.bytes ?? 1

  useKeys((event) => {
    if (event.key === 'h' || event.key === 'Backspace' || event.key === 'ArrowLeft') {
      up()
      return true
    }
    if (event.key === 'm' || event.key === 'M') {
      const index = MODES.findIndex((entry) => entry.value === mode)
      setMode(MODES[(index + (event.key === 'M' ? MODES.length - 1 : 1)) % MODES.length].value)
      setCursor(0)
      return true
    }
    if (event.key === 'o') {
      void pick()
      return true
    }
    if (event.key === '~') {
      setTrail([])
      setRoot(home ?? '/')
      return true
    }
    const entry = entries[cursor]
    if (event.key === 'O' && entry && entry.kind !== 'type') {
      void app.bridge.reveal(entry.path)
      return true
    }
    if (event.key === 't' && entry && entry.kind === 'file') {
      void trashEntry(entry.path, entry.bytes)
      return true
    }
    return false
  }, app.active)

  const rows: RowDef[] = entries.map((entry) => ({
    key: entry.path,
    onEnter: entry.kind === 'dir' ? () => enter(entry.path) : entry.kind === 'file' ? () => void app.bridge.reveal(entry.path) : undefined,
    title: entry.kind === 'type' ? `${entry.count} files` : entry.path,
    content: (
      <>
        <Glyph g={entry.kind === 'dir' ? G.folder : G.file} className="dim" />
        <span className="label">
          {entry.name}
          {entry.kind === 'file' && <span className="sub">{tildify(entry.path.slice(0, -entry.name.length - 1), home)}</span>}
          {entry.kind === 'type' && <span className="sub">{entry.count?.toLocaleString()} files</span>}
        </span>
        {entry.mtimeMs !== undefined && mode === 'old' && <span className="trail">{age(entry.mtimeMs)}</span>}
        <span className="bar-cell">
          <Track value={percent(entry.bytes, max)} />
        </span>
        <span className="trail strong" style={{ minWidth: 72, textAlign: 'right' }}>{bytes(entry.bytes)}</span>
        <span className="trail" style={{ minWidth: 40, textAlign: 'right' }}>
          {data && data.totalBytes > 0 ? `${Math.round(percent(entry.bytes, data.totalBytes))}%` : ''}
        </span>
      </>
    )
  }))

  return (
    <div className="content">
      <div className="controls">
        <span className="path-chip" onClick={pick} title="Choose a folder (o)">
          <Glyph g={G.folder} />
          {tildify(root, home)}
        </span>
        <Button small glyph={G.up} kbd="h" onClick={up} disabled={root === '/'}>Up</Button>
        <ButtonGroup value={mode} options={MODES} onChange={(value) => {
          setMode(value)
          setCursor(0)
        }} />
        {report.loading && <Spinner />}
        {data && !report.loading && (
          <span className="dim">
            {bytes(data.totalBytes)} · {(data.elapsedMs / 1000).toFixed(1)}s{data.truncated ? ' · partial' : ''}
          </span>
        )}
      </div>
      {data?.fs && (
        <div style={{ marginBottom: 'var(--om-panel-gap)' }}>
          <Meter label="Filesystem" value={percent(data.fs.used, data.fs.size)} text={`${bytes(data.fs.avail)} free of ${bytes(data.fs.size)}`} />
        </div>
      )}
      {report.error ? (
        <ErrorRow message={report.error} onRetry={() => report.reload(true)} />
      ) : !data ? (
        <Skeleton lines={12} />
      ) : entries.length === 0 ? (
        <Empty glyph={G.folder}>{mode === 'old' ? 'No files untouched for 180+ days.' : 'This folder is empty.'}</Empty>
      ) : (
        <div className={report.loading ? 'stale' : ''}>
          <List rows={rows} cursor={cursor} setCursor={setCursor} />
        </div>
      )}
      <div className="dim" style={{ marginTop: 'var(--om-panel-gap)' }}>
        <kbd>enter</kbd> open · <kbd>h</kbd> up · <kbd>m</kbd> mode · <kbd>o</kbd> choose folder · <kbd>O</kbd> show in files · <kbd>t</kbd> trash file
      </div>
    </div>
  )
}
