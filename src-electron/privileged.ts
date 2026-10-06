import path from 'node:path'
import { run, which } from './exec'

/* Root work goes through one fixed helper script launched with pkexec, so
   Omarchy's own polkit agent asks for the password — the right prompt for a
   GUI app with no terminal to type into. All actions selected for one run are
   batched into a single invocation: one password prompt, not one per item. */

let helperPath = path.join(__dirname, '..', 'helper', 'omamole-helper')

export const setHelperRoot = (appRoot: string) => {
  helperPath = path.join(appRoot, 'helper', 'omamole-helper')
}

export const getHelperPath = () => helperPath

export type HelperStep = { action: string; arg?: string }

export type HelperOutcome = { action: string; ok: boolean; message: string }

export function parseHelperOutput(stdout: string): HelperOutcome[] {
  const outcomes: HelperOutcome[] = []
  for (const line of stdout.split('\n')) {
    const match = line.match(/^RESULT (\S+) (ok|fail) ?(.*)$/)
    if (match) outcomes.push({ action: match[1], ok: match[2] === 'ok', message: match[3].trim() })
  }
  return outcomes
}

export async function runHelper(steps: readonly HelperStep[]): Promise<{ outcomes: HelperOutcome[]; error?: string }> {
  if (steps.length === 0) return { outcomes: [] }
  if (!(await which('pkexec'))) return { outcomes: [], error: 'pkexec is not installed (polkit)' }
  const args = [helperPath]
  for (const step of steps) {
    args.push(step.action)
    if (step.arg !== undefined) args.push(step.arg)
  }
  /* Generous timeout: the clock includes the time spent typing a password. */
  const result = await run('pkexec', args, { timeoutMs: 10 * 60_000 })
  if (result.code === 126) return { outcomes: [], error: 'Authorization was dismissed' }
  if (result.code === 127) return { outcomes: [], error: 'Not authorized' }
  const outcomes = parseHelperOutput(result.stdout)
  if (outcomes.length === 0) {
    return { outcomes, error: result.stderr.trim().split('\n').pop() || `helper exited with ${result.code}` }
  }
  return { outcomes }
}
