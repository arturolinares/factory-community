import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * Where a command-line tool ends up on a machine.
 *
 * PATH is the right answer when there is one. There often is not: an
 * application launched from Finder gets `/usr/bin:/bin:/usr/sbin:/sbin`, a
 * launchd job gets less, and a fresh install of Factory on somebody else's Mac
 * has no idea what their shell exports. Meanwhile the same agent sits in a
 * different place on two machines owned by the same person — Homebrew uses
 * `/opt/homebrew/bin` on Apple Silicon and `/usr/local/bin` on Intel.
 *
 * So: a short list of the places things are actually installed, checked after
 * PATH and before giving up. It is data, it is dull, and it is the difference
 * between "no agents installed" and a working installation on a machine nobody
 * configured.
 *
 * Not a substitute for configuration. Anything this list misses is what
 * `providers.<id>.command` in a scope config is for.
 */

/** Absolute locations, checked on every platform they exist on. */
const SYSTEM_DIRECTORIES = [
  '/opt/homebrew/bin', // Homebrew, Apple Silicon
  '/usr/local/bin', // Homebrew on Intel, and the traditional place
  '/opt/local/bin', // MacPorts
  '/snap/bin', // Linux
] as const

/** Relative to the user's home. */
const HOME_DIRECTORIES = [
  '.local/bin',
  'bin',
  '.bun/bin',
  '.deno/bin',
  '.cargo/bin',
  '.volta/bin',
  '.npm-global/bin',
  '.yarn/bin',
  'Library/pnpm', // pnpm's global bin on macOS
  '.local/share/pnpm', // and on Linux
] as const

/** Version managers keep a directory per version; the current one is unknowable here, so try them all. */
const VERSIONED = ['.nvm/versions/node', '.asdf/installs/nodejs', '.fnm/node-versions'] as const

/**
 * The usual locations, on this machine.
 *
 * Nothing at all when the environment has no `HOME`. That is not a corner case
 * being tidied away: an environment with no HOME is one nobody described, and
 * rummaging through absolute paths there is exactly how a test starts passing
 * or failing according to what happens to be installed on the laptop running
 * it. Callers that want discovery pass a real environment.
 */
export function knownToolDirectories(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const home = env.HOME?.trim()
  if (home === undefined || home === '') return []

  const found: string[] = [...SYSTEM_DIRECTORIES]
  for (const relative of HOME_DIRECTORIES) found.push(join(home, relative))

  for (const manager of VERSIONED) {
    const root = join(home, manager)
    try {
      for (const version of readdirSync(root)) {
        // nvm nests the binaries one level deeper than asdf does.
        found.push(join(root, version, 'bin'), join(root, version, 'installs', 'bin'))
      }
    } catch {
      // The version manager is not installed. That is the common case.
    }
  }

  return found.filter((path) => existsSync(path))
}

/**
 * The command to actually run.
 *
 * Returns the name unchanged when PATH can find it — spawning `claude` is
 * friendlier in a log than an absolute path, and it keeps working if the user
 * moves their install. Returns an absolute path only when the agent was found
 * somewhere PATH does not mention, because a child process inherits the same
 * PATH and would fail with "command not found" on something we just reported as
 * available.
 */
export function resolveCommand(
  command: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (isAbsolute(command)) return command

  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory.trim() === '') continue
    if (executable(join(directory, command))) return command
  }

  for (const directory of knownToolDirectories(env)) {
    const candidate = join(directory, command)
    if (executable(candidate)) return candidate
  }
  return command
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface Availability {
  readonly available: boolean
  /** Absolute path to the executable, when it was found. */
  readonly path?: string
  readonly reason?: string
  /** Every directory that was looked in, so a failure is actionable. */
  readonly searched?: readonly string[]
}

/**
 * Is this command actually here, and if not, where did we look?
 *
 * Not provider-shaped, deliberately. The probe was written for agent CLIs and
 * then a plugin wanted to ask the same question about its own binary — so this
 * is the question, and `availability(descriptor, …)` is the provider's wording
 * of it. Two callers, one search; the alternative was a fourth copy of the
 * walk, and the copy nobody reads is the one that goes wrong.
 *
 * Nothing is spawned: `which` costs a process per tool per page load, and a
 * directory listing answers the same question.
 */
export function commandAvailability(
  command: string,
  env: Readonly<Record<string, string | undefined>>,
  options: {
    readonly extraDirectories?: readonly string[]
    /** Who wanted it, for the message. Defaults to the command itself. */
    readonly label?: string
    /** The caller's own advice, appended when it was not found. */
    readonly hint?: string
  } = {},
): Availability {
  const label = options.label ?? command

  if (isAbsolute(command)) {
    return executable(command)
      ? { available: true, path: command }
      : {
          available: false,
          reason: `${command} is configured for "${label}", but it is not an executable file`,
        }
  }

  const searched: string[] = []
  for (const directory of [
    ...(env.PATH ?? '').split(delimiter),
    ...(options.extraDirectories ?? []),
  ]) {
    const trimmed = directory.trim()
    if (trimmed === '' || searched.includes(trimmed)) continue
    searched.push(trimmed)
    const candidate = join(trimmed, command)
    if (executable(candidate)) return { available: true, path: candidate }
  }

  // Names what was tried, because "not found on PATH" leaves someone with
  // nowhere to go. What to do about it is the caller's to say: a provider
  // points at its config key, a tool at its install command.
  const looked = `"${command}" was not found. Looked in ${describeSearch(searched)}.`
  return {
    available: false,
    reason: options.hint === undefined ? looked : `${looked} ${options.hint}`,
    searched,
  }
}

/** Enough to recognise, not so much that it fills a terminal. */
function describeSearch(searched: readonly string[]): string {
  if (searched.length === 0) return 'nowhere — PATH was empty'
  if (searched.length <= 4) return searched.join(', ')
  return `${searched.slice(0, 3).join(', ')} and ${searched.length - 3} other directories`
}
