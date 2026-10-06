import { useEffect, useState } from 'react'
import type { ProcessInfo } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { Badge, Button, ErrorRow, Glyph, Meter, Skeleton, StatusMark, Tile } from '../components/ui'
import { useApp, useKeys, useRefresh } from '../lib/app-context'
import { bytes, duration, percent } from '../lib/format'
import { G } from '../lib/glyphs'
import { useLoad } from '../lib/use-load'

const REFRESH_MS = 4000

export function System() {
  const app = useApp()
  const report = useLoad(() => app.bridge.system(), [])
  useRefresh(() => report.reload(true))
  const [cursor, setCursor] = useState(0)
  const [paused, setPaused] = useState(false)

  /* Live while on screen; the main process does the sampling. */
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => report.reload(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [paused, report.reload])

  const btop = async () => {
    const result = await app.bridge.terminal('btop')
    if (!result.ok) app.toast(result.message, undefined, 'urgent')
  }

  useKeys((event) => {
    if (event.key === 'b') {
      void btop()
      return true
    }
    if (event.key === 'p') {
      setPaused((value) => !value)
      return true
    }
    return false
  }, app.active)

  const data = report.data
  if (!data) {
    return <div className="content">{report.error ? <ErrorRow message={report.error} onRetry={() => report.reload(true)} /> : <Skeleton lines={12} />}</div>
  }

  const mem = data.memory
  const rows: RowDef[] = []

  if (data.failedUnits.length === 0) {
    rows.push({
      key: 'units-ok', section: 'Failed units', sectionCount: 0,
      content: (
        <>
          <StatusMark status="good" />
          <span className="label">No failed systemd units</span>
        </>
      )
    })
  }
  for (const unit of data.failedUnits) {
    rows.push({
      key: `unit-${unit.scope}-${unit.unit}`,
      section: 'Failed units',
      sectionCount: data.failedUnits.length,
      onEnter: async () => {
        const result = await app.bridge.terminal('unit-status', unit.unit, unit.scope === 'user')
        if (!result.ok) app.toast(result.message, undefined, 'urgent')
      },
      content: (
        <>
          <StatusMark status="critical" />
          <span className="label">{unit.unit}<span className="sub">{unit.description}</span></span>
          <Badge tone="normal">{unit.scope}</Badge>
          <Glyph g={G.terminal} className="dim" />
        </>
      )
    })
  }

  const procRow = (proc: ProcessInfo, section: string, emphasis: 'cpu' | 'mem'): RowDef => ({
    key: `${section}-${proc.pid}`,
    section,
    title: proc.command || proc.name,
    content: (
      <>
        <span className="trail" style={{ minWidth: 56 }}>{proc.pid}</span>
        <span className="label">
          {proc.name}
          <span className="sub">{proc.command}</span>
        </span>
        <span className={`trail ${emphasis === 'cpu' ? 'strong' : ''}`} style={{ minWidth: 56, textAlign: 'right' }}>{proc.cpu.toFixed(1)}%</span>
        <span className={`trail ${emphasis === 'mem' ? 'strong' : ''}`} style={{ minWidth: 72, textAlign: 'right' }}>{bytes(proc.rssBytes)}</span>
      </>
    )
  })

  data.byCpu.forEach((proc) => rows.push(procRow(proc, 'Top CPU', 'cpu')))
  data.byMemory.forEach((proc) => rows.push(procRow(proc, 'Top memory', 'mem')))

  return (
    <div className="content">
      <div className="controls">
        <Button variant="bordered" glyph={G.terminal} kbd="b" onClick={btop}>Open btop</Button>
        <Button kbd="p" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume' : 'Pause'} live</Button>
        <span className="dim">{paused ? 'paused' : `live · every ${REFRESH_MS / 1000}s`}</span>
      </div>
      <div className="tiles">
        <Tile text glyph={G.system} label="Host" value={data.hostname} sub={`Linux ${data.kernel}`} />
        <Tile label="Uptime" value={duration(data.uptimeSec)} sub={data.boot ? `boot ${data.boot.split('=').pop()?.trim()}` : undefined} />
        <Tile label="Load" value={data.load[0].toFixed(2)} sub={`${data.load[1].toFixed(2)} · ${data.load[2].toFixed(2)} · ${data.cpuCount} threads`} />
        <Tile text label="CPU" value={data.cpuModel.replace(/\s+(w\/|with) .*$/i, '').replace(/\(R\)|\(TM\)/g, '')} sub={`${data.cpuCount} threads`} />
      </div>
      <div style={{ marginBottom: 'var(--om-panel-gap)' }}>
        <Meter label="Memory" value={percent(mem.used, mem.total)} text={`${bytes(mem.used)} / ${bytes(mem.total)} · ${bytes(mem.cached)} cache`} />
        {mem.swapTotal > 0 && (
          <Meter label={mem.zswap !== null ? 'Swap (zswap)' : 'Swap'} value={percent(mem.swapTotal - mem.swapFree, mem.swapTotal)} text={`${bytes(mem.swapTotal - mem.swapFree)} / ${bytes(mem.swapTotal)}`} warnAt={50} critAt={80} />
        )}
        {data.filesystems.map((fs) => (
          <Meter key={fs.source + fs.mount} label={fs.mount} value={percent(fs.used, fs.size)} text={`${bytes(fs.avail)} free · ${fs.fstype}`} />
        ))}
      </div>
      <List rows={rows} cursor={cursor} setCursor={setCursor} />
    </div>
  )
}
