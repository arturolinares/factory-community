import type { Capability } from './capabilities.js'
import { toShellString } from './providers/capability.js'

/**
 * Opening a terminal where the work is.
 *
 * The board can say where a task's steps run; the next thing anybody wants is
 * to be standing there. That means starting a terminal application, which is
 * the most platform-specific thing in Factory — and Community has no
 * `process.platform` in it anywhere, a property worth keeping.
 *
 * So core defines the contract and consumes nothing: with no capability
 * registered the API says so and the board offers the command to copy instead,
 * which is the same degrade-by-absence the rest of the capability model uses.
 * Xaedalon Factory Pro registers one from its desktop plugin, and a third party
 * shipping an integration for their own terminal reaches it through the same
 * door — `@factory/plugin-sdk`.
 */
export const TERMINAL_KIND = 'terminal'

/** Where to open, and what to run once it is open. */
export interface TerminalRequest {
  /** Absolute path to start in. */
  readonly cwd: string
  /**
   * What to run there, as argv rather than a string.
   *
   * Omitted means a shell and nothing more. Argv because that is what the rest
   * of Factory passes around — a provider renders one, the runner spawns one —
   * and because the one place a shell string is unavoidable should be the place
   * that builds it, not every caller.
   *
   * In practice it is the agent's own resume command — `claude --resume <id>`
   * — built from the session Factory recorded for the task. It has to be by
   * id: Claude Code's interactive `--continue` and its session picker both
   * refuse a session created by `claude -p`, which is every session Factory
   * makes. Only `--resume <id>` opens one, which is why Factory chooses the id.
   */
  readonly command?: { readonly command: string; readonly args: readonly string[] }
}

export interface TerminalOutcome {
  readonly opened: boolean
  /** Why not. Present exactly when `opened` is false. */
  readonly reason?: string
  /** What it ran, or would have. The same string a client would copy. */
  readonly command: string
}

export interface TerminalCapability extends Capability {
  /**
   * Open one, and say what happened.
   *
   * Reports rather than swallowing, unlike the notifications capability beside
   * it: a notification nobody sees is a small loss, but a button that appears
   * to do nothing is a bug.
   */
  open(request: TerminalRequest): Promise<TerminalOutcome>
}

/**
 * The one shell string in this, built once.
 *
 * A terminal application runs a shell, so this is the single place where argv
 * has to become text — and both halves come from data: a path out of the
 * database and a command out of a provider descriptor. Neither is safe to
 * interpolate, so both go through `toShellString`, which POSIX-quotes anything
 * outside its safe set.
 *
 * It is deliberately the *same* function that builds the string a Community
 * client puts on the clipboard, so what you copy and what Pro runs cannot
 * differ. That was the entire point of not writing this twice.
 */
export function terminalCommand(request: TerminalRequest): string {
  const cd = toShellString({ command: 'cd', args: [request.cwd] })
  if (request.command === undefined) return cd
  return `${cd} && ${toShellString(request.command)}`
}
