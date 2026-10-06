import { useEffect, useMemo, useState } from 'react'
import type { CleanCategory, CleanCategoryId, CleanPreview } from '../../src-electron/types'
import { List, type RowDef } from '../components/List'
import { Badge, Button, Empty, ErrorRow, Glyph, RiskBadge, Skeleton, Spinner } from '../components/ui'
import { useApp, useKeys, useRefresh } from '../lib/app-context'
import { bytes, tildify } from '../lib/format'
import { G } from '../lib/glyphs'
import { useLoad } from '../lib/use-load'
import { runClean } from './clean-actions'

export function Clean({ onCleaned }: { onCleaned: () => void }) {
  const app = useApp()
  const list = useLoad((force) => app.bridge.cleanList(force), [])
  useRefresh(() => list.reload(true))
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<CleanCategoryId> | null>(null)
  const [preview, setPreview] = useState<CleanPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  /* Grouped for display: system (root) categories, then home. Stable sort
     keeps the backend's order within each group. */
  const categories = useMemo(() => [...(list.data ?? [])].sort((a, b) => Number(b.privileged) - Number(a.privileged)), [list.data])
  /* First load seeds the selection from each category's default. */
  useEffect(() => {
    if (list.data && selected === null) {
      setSelected(new Set(list.data.filter((category) => category.defaultSelected && category.available).map((category) => category.id)))
    }
  }, [list.data, selected])

  const current: CleanCategory | undefined = categories[cursor]

  /* Inspector preview follows the cursor, debounced so j/k stays instant. */
  useEffect(() => {
    if (!current || !current.available) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      app.bridge.cleanPreview(current.id).then(
        (result) => {
          if (!cancelled) {
            setPreview(result)
            setPreviewLoading(false)
          }
        },
        () => {
          if (!cancelled) setPreviewLoading(false)
        }
      )
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [current?.id, current?.available, list.data, app.bridge])

  const chosen = useMemo(() => categories.filter((category) => selected?.has(category.id) && category.available), [categories, selected])
  const chosenBytes = chosen.reduce((sum, category) => sum + (category.bytes ?? 0), 0)

  const toggle = (id: CleanCategoryId) =>
    setSelected((previous) => {
      const next = new Set(previous ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const clean = async () => {
    if (chosen.length === 0) {
      app.toast('Nothing selected', 'Space toggles a category.')
      return
    }
    if (await runClean(app, chosen.map((category) => category.id))) {
      list.reload(true)
      onCleaned()
    }
  }

  const snapshot = async () => {
    const result = await app.bridge.terminal('snapshot')
    app.toast(result.ok ? 'Snapshot started in a terminal' : result.message, undefined, result.ok ? 'normal' : 'urgent')
  }

  useKeys((event) => {
    if (event.key === 'c') {
      void clean()
      return true
    }
    if (event.key === 'a') {
      const all = categories.filter((category) => category.available).map((category) => category.id)
      setSelected((previous) => (previous && previous.size === all.length ? new Set() : new Set(all)))
      return true
    }
    if (event.key === 's') {
      void snapshot()
      return true
    }
    return false
  }, app.active && !!list.data)

  if (!list.data) {
    return (
      <div className="content">
        {list.error ? <ErrorRow message={list.error} onRetry={() => list.reload(true)} /> : <Skeleton lines={10} />}
      </div>
    )
  }

  const rows: RowDef[] = categories.map((category) => {
    const on = !!selected?.has(category.id)
    return {
      key: category.id,
      section: category.privileged ? 'System — needs root' : 'Your home',
      onSpace: category.available ? () => toggle(category.id) : undefined,
      title: category.reason ?? category.description,
      className: category.available ? '' : 'stale',
      content: (
        <>
          <Glyph g={on ? G.check : G.unchecked} className={`check ${on ? 'on' : ''}`} />
          <span className="label">
            {category.label}
            {category.detail && <span className="sub">{category.detail}</span>}
            {!category.available && <span className="sub">{category.reason}</span>}
          </span>
          <RiskBadge risk={category.risk} />
          <span className="trail strong" style={{ minWidth: 72, textAlign: 'right' }}>{bytes(category.bytes)}</span>
        </>
      )
    }
  })

  return (
    <>
      <div className={`content ${list.loading ? 'stale' : ''}`}>
        <div className="controls">
          <Button variant="primary" glyph={G.clean} kbd="c" onClick={clean} disabled={chosen.length === 0}>
            Clean {bytes(chosenBytes)}
          </Button>
          <Button variant="bordered" kbd="a" onClick={() => {
            const all = categories.filter((category) => category.available).map((category) => category.id)
            setSelected((previous) => (previous && previous.size === all.length ? new Set() : new Set(all)))
          }}>
            Select all
          </Button>
          <Button glyph={G.snapshot} kbd="s" onClick={snapshot} title="omarchy snapshot create">
            Snapshot first
          </Button>
          {list.loading && <Spinner />}
        </div>
        <List rows={rows} cursor={cursor} setCursor={setCursor} />
        <div className="dim" style={{ marginTop: 'var(--om-panel-gap)' }}>
          <Kb>space</Kb> select · <Kb>c</Kb> clean · nothing is removed without a confirmation that lists it.
        </div>
      </div>
      <aside className="inspector">
        {current ? (
          <>
            <h2>{current.label}</h2>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <RiskBadge risk={current.risk} />
              {current.privileged && <Badge tone="normal"><Glyph g={G.lock} /> root</Badge>}
              {current.items !== null && <Badge tone="normal">{current.items} item{current.items === 1 ? '' : 's'}</Badge>}
            </div>
            <p>{current.description}</p>
            {preview?.command && <div className="code">{preview.command}</div>}
            {preview?.note && <p className="dim">{preview.note}</p>}
            {previewLoading && !preview ? (
              <Skeleton lines={5} />
            ) : preview && preview.items.length > 0 ? (
              <div className={`preview-list ${previewLoading ? 'stale' : ''}`}>
                {preview.items.slice(0, 120).map((item) => (
                  <div className="row" key={item.path} title={item.path}>
                    <span className="label">{tildify(item.path, app.info?.home ?? null).split('/').slice(-2).join('/')}</span>
                    <span className="trail">{bytes(item.bytes)}</span>
                  </div>
                ))}
                {preview.items.length > 120 && <div className="dim">…and {preview.items.length - 120} more</div>}
              </div>
            ) : preview && !preview.command ? (
              <Empty glyph={G.good}>Nothing to clean here.</Empty>
            ) : null}
          </>
        ) : null}
      </aside>
    </>
  )
}

const Kb = ({ children }: { children: string }) => <kbd>{children}</kbd>
