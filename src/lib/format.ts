const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  let amount = Math.max(0, value)
  let unit = 0
  while (amount >= 1024 && unit < UNITS.length - 1) {
    amount /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : amount < 10 ? 1 : 0
  return `${amount.toFixed(digits)} ${UNITS[unit]}`
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0
}

export function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function age(timestamp: number, now = Date.now()): string {
  const days = Math.floor((now - timestamp) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 60) return `${days} d`
  if (days < 730) return `${Math.round(days / 30)} mo`
  return `${(days / 365).toFixed(1)} y`
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function tildify(target: string, home: string | null): string {
  if (!home) return target
  return target === home ? '~' : target.startsWith(home + '/') ? '~' + target.slice(home.length) : target
}
