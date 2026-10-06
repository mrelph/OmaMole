import { useEffect, useState, type ReactNode } from 'react'
import type { Risk, Status } from '../../src-electron/types'
import { G } from '../lib/glyphs'

export const Glyph = ({ g, className = '' }: { g: string; className?: string }) => (
  <i className={`glyph ${className}`} aria-hidden="true">{g}</i>
)

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  kbd?: string
  glyph?: string
  variant?: 'plain' | 'bordered' | 'primary' | 'urgent' | 'selected'
  small?: boolean
  disabled?: boolean
  title?: string
}

export const Button = ({ children, onClick, kbd, glyph, variant = 'plain', small, disabled, title }: ButtonProps) => (
  <button
    type="button"
    className={`btn ${variant === 'plain' ? '' : variant} ${small ? 'small' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={title}
    tabIndex={-1}
  >
    {glyph && <Glyph g={glyph} />}
    {children}
    {kbd && <kbd>{kbd}</kbd>}
  </button>
)

export const ButtonGroup = <T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) => (
  <div className="button-group" role="radiogroup">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        tabIndex={-1}
        className={`btn ${option.value === value ? 'selected' : ''}`}
        onClick={() => onChange(option.value)}
        role="radio"
        aria-checked={option.value === value}
      >
        {option.label}
      </button>
    ))}
  </div>
)

export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

export const Badge = ({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'accent' | 'urgent' | 'normal' }) => (
  <span className={`badge ${tone === 'normal' ? '' : tone}`}>{children}</span>
)

const RISK_TONE: Record<Risk, 'normal' | 'accent' | 'urgent'> = { low: 'normal', medium: 'accent', review: 'urgent' }

export const RiskBadge = ({ risk }: { risk: Risk }) => <Badge tone={RISK_TONE[risk]}>{risk}</Badge>

const STATUS_GLYPH: Record<Status, string> = { good: G.good, warning: G.warning, serious: G.serious, critical: G.critical, info: G.info }

/* Status is never color alone: glyph + color, and a word wherever there is
   room. Several themes (kraken-depths, hackerman) map green and yellow to the
   same hue, so the glyph is what actually carries the meaning. */
export const StatusMark = ({ status, label }: { status: Status; label?: string }) => (
  <span className={`status ${status}`}>
    <Glyph g={STATUS_GLYPH[status]} />
    {label && <span>{label}</span>}
  </span>
)

export const SectionHeader = ({ children, count, rule = true }: { children: ReactNode; count?: ReactNode; rule?: boolean }) => (
  <div className="section-header">
    <span>{children}</span>
    {count !== undefined && <span className="count">{count}</span>}
    {rule && <span className="rule" />}
  </div>
)

export const Track = ({ value, tone }: { value: number; tone?: 'warning' | 'critical' }) => (
  <div className={`track ${tone ?? ''}`} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
)

export const Meter = ({ label, value, text, warnAt = 80, critAt = 90 }: { label: string; value: number; text: string; warnAt?: number; critAt?: number }) => (
  <div className="meter">
    <span className="meter-label">{label}</span>
    <Track value={value} tone={value >= critAt ? 'critical' : value >= warnAt ? 'warning' : undefined} />
    <span className="meter-value">{text}</span>
  </div>
)

/* `text` tiles hold a word (a hostname, a theme) rather than a number and
   drop to heading size so they fit the same column. */
export const Tile = ({ label, value, sub, glyph, text }: { label: string; value: ReactNode; sub?: ReactNode; glyph?: string; text?: boolean }) => (
  <div className={`tile ${text ? 'text' : ''}`} title={typeof value === 'string' ? value : undefined}>
    <div className="tile-label">
      {glyph && <Glyph g={glyph} />}
      {label}
    </div>
    <div className="tile-value">{value}</div>
    {sub !== undefined && <div className="tile-sub">{sub}</div>}
  </div>
)

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const Spinner = () => {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % FRAMES.length), 80)
    return () => clearInterval(timer)
  }, [])
  return <span className="spinner" aria-label="working">{FRAMES[frame]}</span>
}

export const Empty = ({ glyph = G.empty, children, action }: { glyph?: string; children: ReactNode; action?: ReactNode }) => (
  <div className="empty">
    <Glyph g={glyph} />
    <div>{children}</div>
    {action}
  </div>
)

export const ErrorRow = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="error-row" role="alert">
    <Glyph g={G.critical} />
    <span className="label">{message}</span>
    {onRetry && <Button small variant="urgent" onClick={onRetry} kbd="r">Retry</Button>}
  </div>
)

export const Skeleton = ({ lines = 6 }: { lines?: number }) => (
  <div aria-label="loading">
    {Array.from({ length: lines }, (_, index) => (
      <div key={index} className="skeleton" style={{ width: `${90 - ((index * 17) % 40)}%` }} />
    ))}
  </div>
)
