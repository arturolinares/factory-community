import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { builtinScopeRoot } from '@factory/core'

/** The product's own directory name, inside `.xaedalon/` and on its own before that. */
const SCOPE_PRODUCT_DIR = '.factory'

/**
 * The one module in Factory allowed to ask the operating system where anything
 * is. Everything else takes a resolved ScopeChain as a parameter.
 *
 * That rule is enforced by lint, and it exists because of what the prototype
 * did: nineteen hardcoded paths derived from two anchors that disagreed --
 * a `__dirname` climb and `process.cwd()` -- which happened to coincide only
 * when the service ran under systemd. Logs went to one directory under `pnpm
 * dev` and another under the unit file, and two call sites read the production
 * config while the tests thought they had redirected it.
 */

/**
 * Where a scope lives, inside the directory the product family owns.
 *
 * Factory is one of a family of Xaedalon products, and every one of them will
 * need somewhere to put files that belong to the product rather than to the
 * repository. `.xaedalon/` says which family; `.factory/` says which member.
 * Anything else Xaedalon writes into a repository goes beside it.
 */
export const SCOPE_DIR = join('.xaedalon', SCOPE_PRODUCT_DIR)

/**
 * Where a scope used to live.
 *
 * Still read when the new location is absent, because the alternative is
 * silent and expensive: `openStore` creates a database at whatever path the
 * chain resolves, so an installation that moved underneath someone would show
 * an empty board while every task and run sat unharmed at the old path.
 *
 * Reported by doctor rather than migrated. It is somebody's repository, and
 * their database is in there.
 */
export const LEGACY_SCOPE_DIR = SCOPE_PRODUCT_DIR

export const SCOPE_CONFIG_FILE = 'config.yaml'

export type ScopeKind = 'project' | 'user' | 'builtin'

export interface Scope {
  readonly kind: ScopeKind
  /** Absolute path of the scope directory itself. */
  readonly root: string
  readonly writable: boolean
  readonly exists: boolean
  /**
   * True when this was found at the old `.factory` path rather than under
   * `.xaedalon/`. Carried rather than inferred, so doctor and the Scopes page
   * can say so instead of leaving it to be discovered.
   */
  readonly legacy: boolean
}

export interface ScopeChain {
  /** Highest precedence first: project, then user, then builtin. */
  readonly scopes: readonly Scope[]
  /** Where a new definition goes unless the caller says otherwise. */
  readonly defaultWriteScope: ScopeKind
  /** Nearest enclosing repository, when there is one. Used for guidance only. */
  readonly gitRoot?: string
}

export interface ResolveScopesOptions {
  /** Where discovery starts. Required -- callers pass their own working directory. */
  readonly cwd: string
  /** Process environment. Required, so tests never depend on the ambient one. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Skip the built-in scope. Only useful in tests. */
  readonly includeBuiltin?: boolean
}

/**
 * Build the scope chain.
 *
 * Both arguments are required rather than defaulted. In the prototype
 * `loadFactoryConfig()` could be called with no argument, and two hot paths did
 * exactly that -- silently ignoring the environment variable the tests had set.
 * A required parameter makes that mistake untypeable.
 */
export function resolveScopes(options: ResolveScopesOptions): ScopeChain {
  const { cwd, env } = options
  const includeBuiltin = options.includeBuiltin ?? true

  const override = env.FACTORY_SCOPES?.trim()
  if (override) return chainFromOverride(override, cwd)

  const userRoot = userScopeRoot(env)
  const discovered = discoverProjectRoot(cwd, userRoot)

  const scopes: Scope[] = []
  if (discovered.projectScope !== undefined) {
    scopes.push(describe(discovered.projectScope, 'project', true))
  }
  scopes.push(describe(userRoot, 'user', true))
  if (includeBuiltin) scopes.push(describe(builtinRoot(env), 'builtin', false))

  return {
    scopes,
    defaultWriteScope: discovered.projectScope === undefined ? 'user' : 'project',
    ...(discovered.gitRoot === undefined ? {} : { gitRoot: discovered.gitRoot }),
  }
}

/**
 * `$FACTORY_BUILTIN_ROOT`, else the definitions inside the installed package.
 *
 * `builtinScopeRoot()` finds them relative to its own module, which is right for
 * every ordinary install and wrong for exactly one case: a bundler has flattened
 * the package into a single file somewhere else. A packaged desktop app, a
 * single-executable build and a slim container image all hit that, and all of
 * them know perfectly well where they put the directory — so they can say.
 *
 * Read here because this is the module that owns paths and the environment.
 */
function builtinRoot(env: Readonly<Record<string, string | undefined>>): string {
  const declared = env.FACTORY_BUILTIN_ROOT?.trim()
  return declared === undefined || declared === '' ? builtinScopeRoot() : resolve(declared)
}

/**
 * `$FACTORY_HOME`, else `~/.xaedalon/.factory` — or the old `~/.factory` when
 * that is the only one there.
 *
 * An explicit `FACTORY_HOME` is taken exactly as given: someone who named a
 * directory does not want it second-guessed.
 */
export function userScopeRoot(env: Readonly<Record<string, string | undefined>>): string {
  const home = env.FACTORY_HOME?.trim()
  if (home) return resolve(home)

  const wanted = join(homedir(), SCOPE_DIR)
  if (isDirectory(wanted)) return wanted
  const legacy = join(homedir(), LEGACY_SCOPE_DIR)
  return isDirectory(legacy) ? legacy : wanted
}

/** Whether a resolved root is the old location rather than the new one. */
export const isLegacyRoot = (root: string): boolean =>
  root.endsWith(`${sep}${LEGACY_SCOPE_DIR}`) && !root.endsWith(`${sep}${SCOPE_DIR}`)

export interface Discovery {
  readonly projectScope?: string
  readonly gitRoot?: string
}

/**
 * Walk up looking for a scope directory.
 *
 * Stops at whichever comes first: a repository boundary, the filesystem root,
 * or the user's home directory. The user scope is never a project scope --
 * otherwise running a command from anywhere under `~` would silently promote
 * the user's personal definitions to project-level and change which ones win.
 *
 * A directory whose config declares `scope: user` is skipped and the walk
 * continues, which covers a shared `FACTORY_HOME` that happens to sit above the
 * working directory.
 */
export function discoverProjectRoot(cwd: string, userRoot: string): Discovery {
  const home = realpathOrSelf(homedir())
  /**
   * Both spellings of the user scope, not just the resolved one.
   *
   * With the user scope at `~/.xaedalon/.factory`, a walk that reaches `~` would
   * otherwise find the old `~/.factory` sitting there and promote the user's
   * personal definitions to project level — which is the exact thing this
   * exclusion has always existed to prevent, wearing the other directory name.
   */
  const userRoots = new Set(
    [userRoot, join(homedir(), SCOPE_DIR), join(homedir(), LEGACY_SCOPE_DIR)].map(realpathOrSelf),
  )
  let gitRoot: string | undefined

  let current = resolve(cwd)
  for (;;) {
    if (gitRoot === undefined && existsSync(join(current, '.git'))) gitRoot = current

    // The new location first, then the old one. A repository part-way through
    // the move has both, and the one under `.xaedalon/` is the one meant to win.
    for (const directory of [SCOPE_DIR, LEGACY_SCOPE_DIR]) {
      const candidate = join(current, directory)
      if (userRoots.has(realpathOrSelf(candidate)) || !isDirectory(candidate)) continue
      if (declaredKind(candidate) === 'user') continue
      return {
        projectScope: candidate,
        ...(gitRoot === undefined ? {} : { gitRoot }),
      }
    }

    // A repository is the natural boundary: a project's definitions belong to
    // the project, and walking past its root would pick up a neighbour's.
    if (gitRoot === current) break
    if (realpathOrSelf(current) === home) break

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return gitRoot === undefined ? {} : { gitRoot }
}

/** Read a scope's declared kind, if it declares one. */
export function declaredKind(scopeRoot: string): ScopeKind | undefined {
  const file = join(scopeRoot, SCOPE_CONFIG_FILE)
  if (!existsSync(file)) return undefined
  try {
    const parsed = parseYaml(readFileSync(file, 'utf8')) as { scope?: unknown } | null
    const declared = parsed?.scope
    return declared === 'project' || declared === 'user' || declared === 'builtin'
      ? declared
      : undefined
  } catch {
    // A malformed scope config is reported by `factory doctor`, not by
    // exploding here -- discovery has to keep working so the tool can explain
    // what is wrong.
    return undefined
  }
}

/**
 * `FACTORY_SCOPES` replaces the entire chain with a `:`-separated list, highest
 * precedence first. One variable is enough to make a test or a CI job fully
 * hermetic, which is why there is no per-directory variable for anything else.
 */
function chainFromOverride(value: string, cwd: string): ScopeChain {
  const roots = value
    .split(':')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (isAbsolute(entry) ? entry : resolve(cwd, entry)))

  const scopes = roots.map((root) => {
    const kind = declaredKind(root) ?? 'project'
    return describe(root, kind, kind !== 'builtin')
  })

  return {
    scopes,
    defaultWriteScope: scopes.find((scope) => scope.writable)?.kind ?? 'project',
  }
}

function describe(root: string, kind: ScopeKind, writable: boolean): Scope {
  const resolved = resolve(root)
  return {
    kind,
    root: resolved,
    writable,
    exists: isDirectory(resolved),
    legacy: kind !== 'builtin' && isLegacyRoot(resolved),
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    // Not yet created -- compare the literal path instead. Normalised so a
    // trailing separator cannot make two equal paths look different.
    return path.endsWith(sep) ? path.slice(0, -sep.length) : path
  }
}
