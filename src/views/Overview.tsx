import { useState } from 'react'
import type { CleanCategoryId, Recommendation, ScanReport, Status } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { Badge, Button, ErrorRow, Glyph, Meter, RiskBadge, Skeleton, StatusMark, Tile } from '../components/ui'
import { useApp, useKeys } from '../lib/app-context'
import { ago, bytes, percent } from '../lib/format'
import { G } from '../lib/glyphs'
import type { Loaded } from '../lib/use-load'
import { runClean } from './clean-actions'

const GRADE_STATUS: Record<ScanReport['grade'], Status> = { Excellent: 'good', Good: 'good', Fair: 'warning', Poor: 'critical' }

type Props = { scan: Loaded<ScanReport> }

export function Overview({ scan }: Props) {
  const app = useApp()
  const [cursor, setCursor] = useState(0)
  const { data, error, loading, reload } = scan

  const act = async (rec: Recommendation) => {
    const action = rec.action
    if (!action) return
    if (action.kind === 'view') app.go(action.view)
    else if (action.kind === 'terminal') {
      const result = await app.bridge.terminal(action.action)
      app.toast(result.message, undefined, result.ok ? 'normal' : 'urgent')
    } else if (action.kind === 'clean') {
      if (await runClean(app, action.ids)) reload(true)
    }
  }

  const fixLowRisk = async () => {
    if (!data) return
    const ids = [...new Set(data.recommendations.filter((rec) => rec.auto && rec.action?.kind === 'clean').flatMap((rec) => (rec.action?.kind === 'clean' ? rec.action.ids : [])))] as CleanCategoryId[]
    if (ids.length === 0) {
      app.toast('Nothing low-risk to fix', 'Everything left needs a look first.')
      return
    }
    if (await runClean(app, ids)) reload(true)
  }

  useKeys((event) => {
    if (event.key !== 'f') return false
    void fixLowRisk()
    return true
  }, app.active && !!data)

  if (!data) {
    return (
      <div className="content">
        {error ? <ErrorRow message={error} onRetry={() => reload(true)} /> : <Skeleton lines={10} />}
      </div>
    )
  }

  const recs = data.recommendations
  const rows: RowDef[] = recs.map((rec) => ({
    key: rec.id,
    section: 'Recommendations',
    sectionCount: recs.length,
    className: 'tall',
    onEnter: rec.action ? () => void act(rec) : undefined,
    content: (
      <>
        <StatusMark status={rec.status} />
        <div className="two-line">
          <div className="title">{rec.title}</div>
          <div className="detail">{rec.detail}</div>
        </div>
        <RiskBadge risk={rec.risk} />
        {rec.action && (
          <span className="trail">
            {rec.action.kind === 'terminal' ? <Glyph g={G.terminal} /> : rec.action.kind === 'clean' ? <Glyph g={G.clean} /> : <Glyph g={G.arrow} />}
          </span>
        )}
      </>
    )
  }))

  const disk = data.disk
  const mem = data.memory
  const diskPct = disk ? percent(disk.used, disk.size) : 0
  const memPct = percent(mem.total - mem.available, mem.total)
  const swapPct = percent(mem.swapTotal - mem.swapFree, mem.swapTotal)
  const autoCount = recs.filter((rec) => rec.auto).length

  return (
    <div className={`content ${loading ? 'stale' : ''}`}>
      <div className="hero">
        <div className="score">
          {data.score}
          <small>/100</small>
        </div>
        <div>
          <div className="grade">
            <StatusMark status={GRADE_STATUS[data.grade]} label={data.grade} />
          </div>
          <div className="meta">
            Scanned {ago(data.generatedAt)}
            {data.skipped.length > 0 && <> · skipped {data.skipped.join(', ')}</>}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <Button variant="primary" glyph={G.fix} kbd="f" onClick={fixLowRisk} disabled={autoCount === 0}>
          Fix low-risk
        </Button>
      </div>

      <div style={{ marginBottom: 'var(--om-panel-gap)' }}>
        {disk && <Meter label={`Disk ${disk.mount}`} value={diskPct} text={`${bytes(disk.used)} / ${bytes(disk.size)}`} />}
        <Meter label="Memory" value={memPct} text={`${bytes(mem.total - mem.available)} / ${bytes(mem.total)}`} />
        {mem.swapTotal > 0 && <Meter label="Swap" value={swapPct} text={`${bytes(mem.swapTotal - mem.swapFree)} / ${bytes(mem.swapTotal)}`} warnAt={50} critAt={80} />}
      </div>

      <div className="tiles">
        <Tile glyph={G.clean} label="Reclaimable" value={bytes(data.cleanableBytes)} sub="every category" />
        <Tile glyph={G.update} label="Updates" value={data.pendingUpdates ?? '—'} sub={data.pendingUpdates === null ? 'check skipped' : 'repo + AUR'} />
        <Tile glyph={G.packages} label="Orphans" value={data.orphans} sub="unneeded dependencies" />
        <Tile glyph={G.system} label="Failed units" value={data.failedUnits} sub="system + user" />
      </div>

      {rows.length > 0 ? (
        <List rows={rows} cursor={cursor} setCursor={setCursor} />
      ) : (
        <div className="row">
          <StatusMark status="good" />
          <span className="label">Nothing needs attention.</span>
          <Badge>all clear</Badge>
        </div>
      )}
    </div>
  )
}
