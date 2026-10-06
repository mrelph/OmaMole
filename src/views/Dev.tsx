import { useMemo, useState } from 'react'
import { List, type RowDef } from '../components/List'
import { Badge, Button, ButtonGroup, Empty, ErrorRow, Glyph, Skeleton, Spinner, Tile } from '../components/ui'
import { useApp, useKeys, useRefresh } from '../lib/app-context'
import { age, bytes, tildify } from '../lib/format'
import { G } from '../lib/glyphs'
import { useLoad } from '../lib/use-load'

const AGES = [
  { value: '0', label: 'Any age' },
  { value: '30', label: '30 d+' },
  { value: '90', label: '90 d+' },
  { value: '180', label: '180 d+' }
]

export function Dev({ initialRoot, initialDays }: { initialRoot: string; initialDays: number }) {
  const app = useApp()
  const home = app.info?.home ?? null
  const [root, setRoot] = useState(initialRoot)
  const [days, setDays] = useState(String(initialDays))
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const report = useLoad(() => app.bridge.devScan(root, Number(days)), [root, days])
  useRefresh(() => report.reload(true))
  const artifacts = report.data?.artifacts ?? []

  const chosen = useMemo(() => artifacts.filter((artifact) => selected.has(artifact.path)), [artifacts, selected])
  const chosenBytes = chosen.reduce((sum, artifact) => sum + artifact.bytes, 0)

  const toggle = (path: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const toggleAll = () =>
    setSelected((previous) => (previous.size === artifacts.length ? new Set() : new Set(artifacts.map((artifact) => artifact.path))))

  const pick = async () => {
    const chosenRoot = await app.bridge.pickFolder(root)
    if (chosenRoot) {
      setRoot(chosenRoot)
      setSelected(new Set())
    }
  }

  const remove = async () => {
    if (chosen.length === 0) {
      app.toast('Nothing selected', 'Space selects an artifact, a selects all.')
      return
    }
    const ok = await app.confirm({
      title: `Delete ${chosen.length} build artifact${chosen.length === 1 ? '' : 's'}?`,
      glyph: G.sweep,
      danger: true,
      confirmLabel: `Delete ${bytes(chosenBytes)}`,
      body: (
        <>
          <div className="preview-list" style={{ marginBottom: 8, maxHeight: 200, overflowY: 'auto' }}>
            {chosen.slice(0, 50).map((artifact) => (
              <div className="row" key={artifact.path}>
                <span className="label">{tildify(artifact.path, home)}</span>
                <span className="trail">{bytes(artifact.bytes)}</span>
              </div>
            ))}
            {chosen.length > 50 && <div className="dim">…and {chosen.length - 50} more</div>}
          </div>
          <div className="dim">Deleted permanently. Each is rebuilt by its tool (npm install, cargo build, …) the next time you work on the project.</div>
        </>
      )
    })
    if (!ok) return
    app.setStatus('Removing artifacts…')
    const results = await app.bridge.devRemove(chosen.map((artifact) => artifact.path))
    const freed = results.reduce((sum, result) => sum + result.bytes, 0)
    const failed = results.filter((result) => !result.ok)
    app.toast(
      `Freed ${bytes(freed)}`,
      failed.length ? `${failed.length} failed: ${failed.slice(0, 2).map((result) => result.message).join('; ')}` : `${results.length} artifact(s) removed`,
      failed.length ? 'urgent' : 'normal'
    )
    app.setStatus(`Removed ${results.length - failed.length} artifact(s) · ${bytes(freed)}`)
    setSelected(new Set())
    report.reload(true)
  }

  useKeys((event) => {
    if (event.key === 'a') {
      toggleAll()
      return true
    }
    if (event.key === 'd' || event.key === 'Delete') {
      void remove()
      return true
    }
    if (event.key === 'o') {
      void pick()
      return true
    }
    if (event.key === 'm') {
      const index = AGES.findIndex((entry) => entry.value === days)
      setDays(AGES[(index + 1) % AGES.length].value)
      return true
    }
    const artifact = artifacts[cursor]
    if (event.key === 'O' && artifact) {
      void app.bridge.reveal(artifact.path)
      return true
    }
    return false
  }, app.active)

  const byKind = new Map<string, number>()
  for (const artifact of artifacts) byKind.set(artifact.kind, (byKind.get(artifact.kind) ?? 0) + artifact.bytes)
  const topKinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  const rows: RowDef[] = artifacts.map((artifact) => {
    const on = selected.has(artifact.path)
    return {
      key: artifact.path,
      onSpace: () => toggle(artifact.path),
      onEnter: () => void app.bridge.reveal(artifact.path),
      title: artifact.path,
      content: (
        <>
          <Glyph g={on ? G.check : G.unchecked} className={`check ${on ? 'on' : ''}`} />
          <span className="label">
            {artifact.project.split('/').pop()}
            <span className="sub">{artifact.project}</span>
          </span>
          <Badge tone="normal">{artifact.kind}</Badge>
          <span className="trail" style={{ minWidth: 44, textAlign: 'right' }}>{age(artifact.mtimeMs)}</span>
          <span className="trail strong" style={{ minWidth: 72, textAlign: 'right' }}>{bytes(artifact.bytes)}</span>
        </>
      )
    }
  })

  return (
    <div className="content">
      <div className="controls">
        <span className="path-chip" onClick={pick} title="Choose a folder (o)">
          <Glyph g={G.folder} />
          {tildify(root, home)}
        </span>
        <ButtonGroup value={days} options={AGES} onChange={setDays} />
        <Button variant="primary" glyph={G.sweep} kbd="d" onClick={remove} disabled={chosen.length === 0}>
          Delete {bytes(chosenBytes)}
        </Button>
        <Button variant="bordered" kbd="a" onClick={toggleAll} disabled={artifacts.length === 0}>Select all</Button>
        {report.loading && <Spinner />}
      </div>

      {report.data && (
        <div className="tiles">
          <Tile glyph={G.dev} label="Artifacts" value={artifacts.length} sub={`${(report.data.elapsedMs / 1000).toFixed(1)}s scan${report.data.truncated ? ' · partial' : ''}`} />
          <Tile glyph={G.disk} label="Total" value={bytes(report.data.totalBytes)} sub="all regenerable" />
          {topKinds.map(([kind, size]) => (
            <Tile key={kind} label={kind} value={bytes(size)} />
          ))}
        </div>
      )}

      {report.error ? (
        <ErrorRow message={report.error} onRetry={() => report.reload(true)} />
      ) : !report.data ? (
        <Skeleton lines={12} />
      ) : artifacts.length === 0 ? (
        <Empty glyph={G.good}>No build artifacts{Number(days) > 0 ? ` older than ${days} days` : ''} under {tildify(root, home)}.</Empty>
      ) : (
        <div className={report.loading ? 'stale' : ''}>
          <List rows={rows} cursor={cursor} setCursor={setCursor} />
        </div>
      )}
      <div className="dim" style={{ marginTop: 'var(--om-panel-gap)' }}>
        Only matched with their project file (package.json, Cargo.toml, pyvenv.cfg…), so a hand-made build/ folder is never listed.
        <br />
        <kbd>space</kbd> select · <kbd>a</kbd> all · <kbd>d</kbd> delete · <kbd>m</kbd> age filter · <kbd>o</kbd> folder · <kbd>enter</kbd> show in files
      </div>
    </div>
  )
}
