import type { CleanCategory, OmarchyReport, PackagesReport, Recommendation, ScanReport } from '../types'
import { df, readMeminfo } from './common'

const GiB = 1024 ** 3

export type ScanInputs = {
  disk: ScanReport['disk']
  memory: ScanReport['memory']
  failedUnits: number
  clean: CleanCategory[] | null
  packages: PackagesReport | null
  omarchy: OmarchyReport | null
}

export const gradeFor = (score: number): ScanReport['grade'] =>
  score >= 90 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Poor'

const fmt = (bytes: number) => {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} GiB`
  return `${Math.round(bytes / 1024 ** 2)} MiB`
}

/* Pure: the same inputs always produce the same score, so it is testable
   and the overview never disagrees with the detail views it summarises. */
export function scoreSystem(inputs: ScanInputs): Omit<ScanReport, 'generatedAt' | 'disk' | 'memory'> {
  let score = 100
  const recommendations: Recommendation[] = []
  const skipped: string[] = []

  if (inputs.disk) {
    const usedRatio = inputs.disk.used / Math.max(1, inputs.disk.size)
    if (usedRatio >= 0.9) {
      score -= 25
      recommendations.push({
        id: 'disk-critical', title: `Root filesystem is ${Math.round(usedRatio * 100)}% full`,
        detail: 'Pacman needs free space to upgrade. Clean caches or find what is large.',
        risk: 'low', status: 'critical', action: { kind: 'view', view: 'disk' }, auto: false
      })
    } else if (usedRatio >= 0.8) {
      score -= 10
      recommendations.push({
        id: 'disk-high', title: `Root filesystem is ${Math.round(usedRatio * 100)}% full`,
        detail: 'Worth reclaiming space before it becomes a problem.',
        risk: 'low', status: 'warning', action: { kind: 'view', view: 'disk' }, auto: false
      })
    }
  } else {
    skipped.push('disk usage')
  }

  const memRatio = inputs.memory.available / Math.max(1, inputs.memory.total)
  if (memRatio < 0.1) {
    score -= 10
    recommendations.push({
      id: 'memory-low', title: `Only ${Math.round(memRatio * 100)}% of memory is available`,
      detail: 'See which processes hold the most memory.',
      risk: 'review', status: 'serious', action: { kind: 'view', view: 'system' }, auto: false
    })
  }

  if (inputs.failedUnits > 0) {
    score -= Math.min(20, inputs.failedUnits * 5)
    recommendations.push({
      id: 'failed-units', title: `${inputs.failedUnits} systemd unit${inputs.failedUnits === 1 ? '' : 's'} failed`,
      detail: 'A failed service is usually a broken setting or a missing dependency.',
      risk: 'review', status: 'serious', action: { kind: 'view', view: 'system' }, auto: false
    })
  }

  let cleanableBytes = 0
  if (inputs.clean) {
    const autoIds = inputs.clean.filter((category) => category.available && category.risk === 'low' && (category.bytes ?? 0) > 0)
    const autoBytes = autoIds.reduce((sum, category) => sum + (category.bytes ?? 0), 0)
    cleanableBytes = inputs.clean.reduce((sum, category) => sum + (category.available ? category.bytes ?? 0 : 0), 0)
    if (autoBytes >= 5 * GiB) score -= 10
    else if (autoBytes >= GiB) score -= 5
    if (autoBytes >= 100 * 1024 ** 2) {
      recommendations.push({
        id: 'clean-low-risk', title: `${fmt(autoBytes)} of caches and old packages can go`,
        detail: autoIds.map((category) => category.label).join(', '),
        risk: 'low', status: autoBytes >= GiB ? 'warning' : 'info',
        action: { kind: 'clean', ids: autoIds.map((category) => category.id) }, auto: true
      })
    }
    const coredumps = inputs.clean.find((category) => category.id === 'coredumps')
    if (coredumps && (coredumps.items ?? 0) > 0) {
      recommendations.push({
        id: 'coredumps', title: `${coredumps.items} crash dump${coredumps.items === 1 ? '' : 's'} stored (${fmt(coredumps.bytes ?? 0)})`,
        detail: 'Something crashed recently. Look before you delete: coredumpctl list.',
        risk: 'medium', status: 'info', action: { kind: 'clean', ids: ['coredumps'] }, auto: false
      })
    }
  } else {
    skipped.push('cleanup estimate')
  }

  if (inputs.packages) {
    const { updates, orphans, pacnew } = inputs.packages
    if (updates === null) {
      skipped.push('pending updates')
    } else if (updates.length > 0) {
      score -= updates.length >= 50 ? 10 : 3
      recommendations.push({
        id: 'updates', title: `${updates.length} package update${updates.length === 1 ? '' : 's'} available`,
        detail: 'Run omarchy update rather than a bare pacman -Syu: it handles migrations and keyrings.',
        risk: 'medium', status: updates.length >= 50 ? 'warning' : 'info',
        action: { kind: 'terminal', action: 'system-update' }, auto: false
      })
    }
    if (orphans.length > 0) {
      score -= 5
      recommendations.push({
        id: 'orphans', title: `${orphans.length} orphaned package${orphans.length === 1 ? '' : 's'}`,
        detail: 'Dependencies nothing needs any more. Review before removing.',
        risk: 'review', status: 'info', action: { kind: 'terminal', action: 'orphans' }, auto: false
      })
    }
    if (pacnew.length > 0) {
      score -= 5
      recommendations.push({
        id: 'pacnew', title: `${pacnew.length} unmerged .pacnew/.pacsave file${pacnew.length === 1 ? '' : 's'}`,
        detail: 'Upgraded packages shipped new config defaults that were not merged.',
        risk: 'review', status: 'warning', action: { kind: 'terminal', action: 'pacdiff' }, auto: false
      })
    }
  } else {
    skipped.push('packages')
  }

  if (inputs.omarchy) {
    const { hyprland, update, backups } = inputs.omarchy
    if (hyprland && hyprland.configErrors.length > 0) {
      score -= 10
      recommendations.push({
        id: 'hypr-errors', title: `Hyprland reports ${hyprland.configErrors.length} config error${hyprland.configErrors.length === 1 ? '' : 's'}`,
        detail: hyprland.configErrors[0],
        risk: 'review', status: 'serious', action: { kind: 'view', view: 'omarchy' }, auto: false
      })
    }
    if (update && update.length > 0) {
      score -= 3
      recommendations.push({
        id: 'omarchy-update', title: 'An Omarchy update is available',
        detail: update[0], risk: 'medium', status: 'info',
        action: { kind: 'terminal', action: 'system-update' }, auto: false
      })
    }
    if (backups.length >= 20) {
      recommendations.push({
        id: 'config-backups', title: `${backups.length} config backups in ~/.config`,
        detail: 'Left behind by omarchy refresh and plugin installs. Review, then move to trash.',
        risk: 'review', status: 'info', action: { kind: 'view', view: 'omarchy' }, auto: false
      })
    }
  } else {
    skipped.push('omarchy')
  }

  score = Math.max(0, Math.min(100, score))
  const order = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 }
  recommendations.sort((a, b) => order[a.status] - order[b.status])
  return { score, grade: gradeFor(score), cleanableBytes, failedUnits: inputs.failedUnits, pendingUpdates: inputs.packages?.updates?.length ?? null, orphans: inputs.packages?.orphans.length ?? 0, recommendations, skipped }
}

export async function rootDisk(): Promise<ScanReport['disk']> {
  const row = (await df('/'))[0]
  return row ? { mount: row.mount, size: row.size, used: row.used, avail: row.avail } : null
}

export async function memorySummary(): Promise<ScanReport['memory']> {
  const mem = await readMeminfo()
  return { total: mem.MemTotal ?? 0, available: mem.MemAvailable ?? 0, swapTotal: mem.SwapTotal ?? 0, swapFree: mem.SwapFree ?? 0 }
}
