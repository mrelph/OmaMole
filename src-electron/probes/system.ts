import { readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import { run } from '../exec'
import type { FailedUnit, ProcessInfo, SystemReport } from '../types'
import { df, readMeminfo } from './common'

const CLK_TCK = 100
const PAGE_SIZE = 4096

type Sample = { name: string; ticks: number; rssPages: number }

/* /proc/<pid>/stat: the comm field is parenthesised and may itself contain
   spaces or parens, so split after the *last* ')'. */
export function parseProcStat(text: string): Sample | null {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open === -1 || close === -1) return null
  const rest = text.slice(close + 2).split(' ')
  /* rest[0] is field 3 (state); utime=14, stime=15, rss=24 */
  const utime = Number(rest[11])
  const stime = Number(rest[12])
  const rss = Number(rest[21])
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
  return { name: text.slice(open + 1, close), ticks: utime + stime, rssPages: Number.isFinite(rss) ? rss : 0 }
}

async function sampleProcesses(): Promise<Map<number, Sample>> {
  const samples = new Map<number, Sample>()
  const entries = await readdir('/proc')
  await Promise.all(entries.map(async (entry) => {
    if (!/^\d+$/.test(entry)) return
    try {
      const sample = parseProcStat(await readFile(`/proc/${entry}/stat`, 'utf8'))
      if (sample) samples.set(Number(entry), sample)
    } catch {
      /* exited between readdir and read */
    }
  }))
  return samples
}

async function commandLine(pid: number): Promise<string> {
  try {
    return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0+$/, '').replace(/\0/g, ' ')
  } catch {
    return ''
  }
}

/* Real current CPU use: two samples of utime+stime 500 ms apart. ps's %CPU
   is a lifetime average and makes a long-idle browser look busy. */
async function processes(): Promise<{ byCpu: ProcessInfo[]; byMemory: ProcessInfo[] }> {
  const first = await sampleProcesses()
  const started = Date.now()
  await new Promise((resolve) => setTimeout(resolve, 500))
  const second = await sampleProcesses()
  const seconds = (Date.now() - started) / 1000

  const all: Omit<ProcessInfo, 'command'>[] = []
  for (const [pid, sample] of second) {
    const before = first.get(pid)
    const cpu = before ? ((sample.ticks - before.ticks) / CLK_TCK / seconds) * 100 : 0
    all.push({ pid, name: sample.name, cpu: Math.max(0, cpu), rssBytes: sample.rssPages * PAGE_SIZE })
  }
  const withCommand = async (list: Omit<ProcessInfo, 'command'>[]) =>
    Promise.all(list.map(async (proc) => ({ ...proc, command: await commandLine(proc.pid) })))

  return {
    byCpu: await withCommand([...all].sort((a, b) => b.cpu - a.cpu).slice(0, 12)),
    byMemory: await withCommand([...all].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, 12))
  }
}

export async function failedUnits(): Promise<FailedUnit[]> {
  const query = async (scope: 'system' | 'user') => {
    const args = ['--failed', '--no-legend', '--plain', '-o', 'json']
    if (scope === 'user') args.unshift('--user')
    const result = await run('systemctl', args, { timeoutMs: 8000 })
    try {
      const rows = JSON.parse(result.stdout || '[]') as { unit: string; description?: string }[]
      return rows.map((row) => ({ unit: row.unit, scope, description: row.description ?? '' }))
    } catch {
      return []
    }
  }
  const [system, user] = await Promise.all([query('system'), query('user')])
  return [...system, ...user]
}

export async function systemReport(): Promise<SystemReport> {
  const [mem, procs, failed, filesystems, boot, zswap] = await Promise.all([
    readMeminfo(),
    processes(),
    failedUnits(),
    df(),
    run('systemd-analyze', [], { timeoutMs: 8000 }),
    readFile('/sys/module/zswap/parameters/enabled', 'utf8').catch(() => 'N')
  ])
  const total = mem.MemTotal ?? os.totalmem()
  const available = mem.MemAvailable ?? os.freemem()
  const cpus = os.cpus()

  /* btrfs shows one row per subvolume mount; keep the first per device. */
  const seen = new Set<string>()
  const uniqueFs = filesystems.filter((row) => {
    if (seen.has(row.source)) return false
    seen.add(row.source)
    return true
  })

  return {
    hostname: os.hostname(),
    kernel: os.release(),
    uptimeSec: os.uptime(),
    boot: boot.code === 0 ? boot.stdout.split('\n')[0].replace(/^Startup finished in /, '') : null,
    cpuModel: cpus[0]?.model.trim() ?? 'unknown',
    cpuCount: cpus.length,
    load: os.loadavg() as [number, number, number],
    memory: {
      total,
      available,
      used: total - available,
      buffers: mem.Buffers ?? 0,
      cached: (mem.Cached ?? 0) + (mem.SReclaimable ?? 0),
      swapTotal: mem.SwapTotal ?? 0,
      swapFree: mem.SwapFree ?? 0,
      zswap: zswap.trim() === 'Y' ? mem.Zswapped ?? 0 : null
    },
    byCpu: procs.byCpu,
    byMemory: procs.byMemory,
    failedUnits: failed,
    filesystems: uniqueFs.map((row) => ({ ...row }))
  }
}
