import type { CapabilityHost, Problem } from '@factory/core'
import type { PluginCandidate, ScopeChain, SettingsHolder } from '@factory/config'

/**
 * Everything a command needs, passed in rather than reached for.
 *
 * Commands are pure functions over this: they return lines and an exit code and
 * touch nothing global. That is what lets the whole CLI be specified without
 * spawning a process, and it is the same discipline as resolveScopes, which
 * takes its cwd and environment rather than reading them.
 */
export interface CliContext {
  readonly chain: ScopeChain
  readonly host: CapabilityHost
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  /** Problems raised while starting up, e.g. a plugin that would not load. */
  readonly startupProblems: readonly Problem[]
  /** Everything Factory knows how to load, with what is switched off marked. */
  readonly plugins: readonly PluginCandidate[]
  /** The one live copy of the settings, shared with whatever else reads them. */
  readonly settings: SettingsHolder
}

export interface CommandResult {
  readonly lines: readonly string[]
  /** 0 success, 1 something the user must fix, 2 usage error. */
  readonly exitCode: number
  /** Present when --json was asked for. */
  readonly json?: unknown
}

export const ok = (lines: readonly string[], json?: unknown): CommandResult => ({
  lines,
  exitCode: 0,
  ...(json === undefined ? {} : { json }),
})

export const failed = (lines: readonly string[], json?: unknown): CommandResult => ({
  lines,
  exitCode: 1,
  ...(json === undefined ? {} : { json }),
})
