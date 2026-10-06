import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { useApp, useKeys } from '../lib/app-context'
import { SectionHeader } from './ui'

export type RowDef = {
  key: string
  /* A header is drawn whenever this changes from the previous row. */
  section?: string
  sectionCount?: ReactNode
  content: ReactNode
  className?: string
  current?: boolean
  onEnter?: () => void
  onSpace?: () => void
  title?: string
}

type ListProps = {
  rows: RowDef[]
  cursor: number
  setCursor: (index: number) => void
  /* Extra per-view keys, run after the list's own j/k/g/G/Enter/Space. */
  onKey?: (event: KeyboardEvent, row: RowDef | undefined) => boolean | void
  className?: string
}

/* Every list in OmaMole is one of these: a single cursor, moved by j/k or
   the mouse, acted on by Enter, toggled by Space. Hover writes the cursor,
   so keyboard and mouse never show two different highlights. */
export function List({ rows, cursor, setCursor, onKey, className = '' }: ListProps) {
  const { active } = useApp()
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const clamped = rows.length === 0 ? -1 : Math.min(Math.max(0, cursor), rows.length - 1)
  const fromKeyboard = useRef(false)

  useEffect(() => {
    if (clamped !== cursor && clamped >= 0) setCursor(clamped)
  }, [clamped, cursor, setCursor])

  useEffect(() => {
    if (!fromKeyboard.current) return
    fromKeyboard.current = false
    refs.current[clamped]?.scrollIntoView({ block: 'nearest' })
  }, [clamped])

  const move = (index: number) => {
    if (rows.length === 0) return
    fromKeyboard.current = true
    setCursor(Math.min(rows.length - 1, Math.max(0, index)))
  }

  useKeys((event) => {
    const row = rows[clamped]
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        move(clamped + 1)
        return true
      case 'k':
      case 'ArrowUp':
        move(clamped - 1)
        return true
      case 'g':
      case 'Home':
        move(0)
        return true
      case 'G':
      case 'End':
        move(rows.length - 1)
        return true
      case 'PageDown':
        move(clamped + 10)
        return true
      case 'PageUp':
        move(clamped - 10)
        return true
      case 'Enter':
        if (row?.onEnter) {
          row.onEnter()
          return true
        }
        break
      case ' ':
        if (row?.onSpace) {
          row.onSpace()
          return true
        }
        break
    }
    return onKey?.(event, row)
  }, active)

  let lastSection: string | undefined
  return (
    <div className={`list ${active ? '' : 'inactive'} ${className}`} role="listbox">
      {rows.map((row, index) => {
        const header = row.section !== undefined && row.section !== lastSection
        lastSection = row.section
        return (
          <Fragment key={row.key}>
            {header && <SectionHeader count={row.sectionCount}>{row.section}</SectionHeader>}
            <div
              ref={(element) => {
                refs.current[index] = element
              }}
              role="option"
              aria-selected={index === clamped}
              title={row.title}
              className={`row ${index === clamped ? 'cursor' : ''} ${row.current ? 'current' : ''} ${row.className ?? ''}`}
              onMouseMove={() => {
                if (index !== clamped) setCursor(index)
              }}
              onClick={() => {
                setCursor(index)
                if (row.onSpace) row.onSpace()
                else row.onEnter?.()
              }}
              onDoubleClick={() => {
                if (row.onSpace && row.onEnter) row.onEnter()
              }}
            >
              {row.content}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
