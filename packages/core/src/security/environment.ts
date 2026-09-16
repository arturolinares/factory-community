import { DEFAULT_PROFILE, isConfined, type ExecutionProfile } from './profile.js'

/**
 * What environment an agent's process gets.
 *
 * `runStep` spawned every child with `env: { ...process.env, ... }`. That made
 * it the one module below an entry point reaching for the ambient environment,
 * in a codebase whose whole discipline is the opposite — `PluginContext.env`
 * exists so "a plugin that calls `process.env` cannot be tested against a
 * machine it is not running on", and `CapabilityHost` defaults env to `{}`
 * "never to the ambient environment". The eslint rule that enforces this
 * covers `cwd`, `homedir` and `tmpdir`, and not `env`, which is how the gap
 * stayed open.
 *
 * The practical consequence was that every coding agent Factory started
 * inherited every credential the daemon had: cloud keys, registry tokens, the
 * SSH agent socket.
 *
 * A **deny-list**, not an allow-list. An allow-list is the safer instinct and
 * the wrong answer here: Factory does not know what a project's own tooling
 * needs, and a `default` profile that broke `npm test` on an unfamiliar
 * repository would be turned off by everyone on their first afternoon. The
 * document says as much — enforce with boundaries, not with an inventory of
 * commands. So this drops what is shaped like a credential and passes the rest.
 *
 * Over-matching is the acceptable direction of error, and it is made survivable
 * two ways: a provider declares what it needs (`passEnv`), and every name
 * withheld is *reported against the step*, so "it cannot reach the registry"
 * takes one look rather than an afternoon.
 */

/**
 * Segments that mean "this is a credential".
 *
 * Matched segment-wise on `_` rather than as substrings, so `TOKEN` catches
 * `GITHUB_TOKEN` and `NPM_TOKEN` without catching `TOKENIZERS_PARALLELISM`.
 */
export const CREDENTIAL_WORDS: readonly string[] = [
  'TOKEN',
  'SECRET',
  'SECRETS',
  'PASSWORD',
  'PASSWD',
  'CREDENTIAL',
  'CREDENTIALS',
  'APIKEY',
  'PASSPHRASE',
]

/**
 * Whole names that are credentials without saying so.
 *
 * `SSH_AUTH_SOCK` is not a key but it is a handle to every key the user has
 * loaded, which is the same thing. `DATABASE_URL` regularly carries a password
 * inside it, and §13 of the standard names it.
 */
export const CREDENTIAL_NAMES: readonly string[] = ['SSH_AUTH_SOCK', 'DATABASE_URL', 'API_KEY']

/** Families where every member is a credential. */
export const CREDENTIAL_PREFIXES: readonly string[] = ['AWS_']

/** Endings that are credentials however the rest of the name reads. */
export const CREDENTIAL_SUFFIXES: readonly string[] = [
  '_API_KEY',
  '_ACCESS_KEY',
  '_PRIVATE_KEY',
  '_SECRET_KEY',
]

/**
 * Whether a variable's name says it holds a credential.
 *
 * Exported because it is the part most likely to need extending, and because a
 * caller that wants to explain a decision needs the same answer the filter
 * used.
 */
export function looksLikeCredential(name: string): boolean {
  const upper = name.toUpperCase()
  if (CREDENTIAL_NAMES.includes(upper)) return true
  if (CREDENTIAL_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true
  if (CREDENTIAL_SUFFIXES.some((suffix) => upper.endsWith(suffix))) return true
  return upper.split('_').some((segment) => CREDENTIAL_WORDS.includes(segment))
}

export interface EnvironmentPolicy {
  readonly profile?: ExecutionProfile
  /**
   * Names to keep even though they look like a credential.
   *
   * This is how a provider's own authentication survives, and it is the
   * sharpest edge in the whole profile: filter `ANTHROPIC_API_KEY` and every
   * Claude run fails at once. So it is declared by the provider descriptor,
   * beside the flags it also declares, rather than hard-coded in a list here
   * that a new provider would have to come and edit.
   */
  readonly keep?: readonly string[]
}

export interface FilteredEnvironment {
  readonly env: Readonly<Record<string, string>>
  /** Names that were dropped, in the order they appeared. Reported, never silent. */
  readonly withheld: readonly string[]
}

/**
 * The environment to spawn a step with.
 *
 * Under `full-access` nothing is dropped: the profile's entire promise is that
 * the agent gets what the user's own shell would get, and quietly withholding
 * something would make it a third profile nobody asked for.
 *
 * `undefined` values are dropped in both profiles, because that is what
 * `process.env` means by an unset variable and `spawn` would otherwise receive
 * the string "undefined".
 */
export function agentEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  policy: EnvironmentPolicy = {},
): FilteredEnvironment {
  const profile = policy.profile ?? DEFAULT_PROFILE
  const keep = new Set((policy.keep ?? []).map((name) => name.toUpperCase()))

  const kept: Record<string, string> = {}
  const withheld: string[] = []

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (isConfined(profile) && looksLikeCredential(name) && !keep.has(name.toUpperCase())) {
      withheld.push(name)
      continue
    }
    kept[name] = value
  }

  return { env: kept, withheld }
}

/**
 * What to tell somebody reading the step's output.
 *
 * Names, never values — a name is not a secret and is the only useful half.
 * Written here so the wording is the same wherever a run is read from.
 */
export function withheldMessage(withheld: readonly string[]): string {
  return (
    `Factory withheld ${withheld.length} environment ` +
    `variable${withheld.length === 1 ? '' : 's'} from this step under the Default ` +
    `profile: ${[...withheld].sort().join(', ')}. ` +
    `A provider declares what it needs with passEnv; Full Access withholds nothing.`
  )
}
