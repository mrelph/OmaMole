import { spawn } from 'node:child_process'
import { which } from './exec'
import type { TerminalActionId } from './types'

/* Interactive or long-running system work (updates, orphan review, merging
   .pacnew files) is handed to Omarchy's own floating terminal rather than
   reimplemented: sudo prompts belong in a terminal, and Omarchy's update
   path handles migrations and keyrings that a bare pacman -Syu would not.

   The renderer can only name an action from this table; it never supplies a
   command string. The one argument (a unit name) is validated. */

const UNIT_PATTERN = /^[A-Za-z0-9@._:-]{1,200}\.(service|socket|timer|mount|target|path|scope|slice|automount|swap|device)$/

export function terminalCommand(action: TerminalActionId, arg?: string, userScope = false): string | null {
  switch (action) {
    case 'system-update':
      return 'omarchy update'
    case 'orphans':
      return 'omarchy-update-orphan-pkgs'
    case 'pacdiff':
      return 'sudo DIFFPROG="nvim -d" pacdiff'
    case 'snapshot':
      return 'omarchy snapshot create'
    case 'debug':
      return 'omarchy debug --no-sudo --print | less -R'
    case 'btop':
      return 'btop'
    case 'unit-status': {
      if (!arg || !UNIT_PATTERN.test(arg)) return null
      const scope = userScope ? ' --user' : ''
      return `systemctl${scope} status --no-pager -l '${arg}'; echo; journalctl${scope} -u '${arg}' -b --no-pager -n 60`
    }
    default:
      return null
  }
}

export async function launchTerminal(action: TerminalActionId, arg?: string, userScope = false): Promise<{ ok: boolean; message: string }> {
  const command = terminalCommand(action, arg, userScope)
  if (!command) return { ok: false, message: 'Unknown or invalid action' }

  if (action === 'btop' && (await which('omarchy-launch-or-focus-tui'))) {
    spawn('omarchy-launch-or-focus-tui', ['btop'], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, message: 'Opened btop' }
  }
  if (await which('omarchy-launch-floating-terminal-with-presentation')) {
    spawn('omarchy-launch-floating-terminal-with-presentation', [command], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, message: 'Opened in a floating terminal' }
  }
  if (await which('xdg-terminal-exec')) {
    spawn('xdg-terminal-exec', ['bash', '-c', `${command}; read -rp "Press Enter to close"`], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, message: 'Opened in a terminal' }
  }
  return { ok: false, message: 'No terminal launcher found' }
}
