import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import path from 'node:path'

export type RunResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type RunOptions = {
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  /* Called per complete stdout line; output is then not buffered. */
  onLine?: (line: string) => void
  maxBuffer?: number
}

/* Never throws for a non-zero exit: callers decide what an exit code means
   (checkupdates exits 2 for "nothing to do"). A missing binary surfaces as
   code null with the spawn error in stderr. Commands run with LC_ALL=C so
   parsers never meet translated or comma-decimal output. */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = 30_000, onLine, maxBuffer = 64 * 1024 * 1024 } = options
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let pending = ''
    let timedOut = false
    let settled = false

    const child = spawn(command, args, {
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000).unref()
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (onLine) {
        pending += chunk
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) onLine(line)
      } else if (stdout.length < maxBuffer) {
        stdout += chunk
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 256 * 1024) stderr += chunk
    })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (onLine && pending) onLine(pending)
      resolve({ code, stdout, stderr, timedOut })
    }
    child.on('error', (error) => {
      stderr += error.message
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

const whichCache = new Map<string, string | null>()

export async function which(binary: string): Promise<string | null> {
  if (whichCache.has(binary)) return whichCache.get(binary) ?? null
  const dirs = (process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin').split(':').filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir, binary)
    try {
      await access(candidate, constants.X_OK)
      whichCache.set(binary, candidate)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  whichCache.set(binary, null)
  return null
}

/* Tiny TTL cache so the overview and the detail views can share one probe
   (checkupdates hits the network) instead of each running it. */
export function cached<T>(ttlMs: number, load: () => Promise<T>): (force?: boolean) => Promise<T> {
  let value: { at: number; promise: Promise<T> } | null = null
  return (force = false) => {
    if (!force && value && Date.now() - value.at < ttlMs) return value.promise
    const promise = load()
    value = { at: Date.now(), promise }
    promise.catch(() => {
      value = null
    })
    return promise
  }
}
