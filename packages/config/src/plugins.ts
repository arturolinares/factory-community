import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { CapabilityHost, FactoryPlugin, Problem } from '@factory/core'
import { SCOPE_CONFIG_FILE, type Scope, type ScopeChain, type ScopeKind } from './scopes.js'

/**
 * Plugins declared by a scope.
 *
 * A project ships its plugins in its own repository, resolved through the same
 * layered chain as its definitions — so cloning a repo gets you its step kinds
 * and providers along with its workflows.
 *
 * Trust: loading a plugin executes code from the project directory, with the
 * same authority as the Factory process. That is the same bargain as a
 * `package.json` script or a git hook, and it is fine for a local-first tool,
 * but it is a real boundary and it should be stated rather than discovered.
 * A signing or allow-list model belongs with the wider plugin trust story, not
 * here.
 */

export interface ScopePluginDeclaration {
  readonly scope: Scope
  /** As written in config.yaml. */
  readonly specifier: string
  /** Absolute path or bare package specifier, ready to import. */
  readonly resolved: string
}

/** Read the `plugins:` list from every scope, in chain order. */
export function declaredPlugins(chain: ScopeChain): ScopePluginDeclaration[] {
  const declarations: ScopePluginDeclaration[] = []

  for (const scope of chain.scopes) {
    const file = resolvePath(scope.root, SCOPE_CONFIG_FILE)
    if (!existsSync(file)) continue
    let parsed: { plugins?: unknown } | null
    try {
      parsed = parseYaml(readFileSync(file, 'utf8')) as { plugins?: unknown } | null
    } catch {
      continue // reported by the scope-config doctor rule
    }
    const list = Array.isArray(parsed?.plugins) ? parsed.plugins : []
    for (const entry of list) {
      if (typeof entry !== 'string' || entry.trim() === '') continue
      declarations.push({
        scope,
        specifier: entry,
        // A relative path belongs to the scope that declared it; a bare
        // specifier is left alone so Node resolves it as a package.
        resolved: entry.startsWith('.') || isAbsolute(entry)
          ? resolvePath(scope.root, entry)
          : entry,
      })
    }
  }

  return declarations
}

/**
 * A plugin Factory knows about, whether or not it is loaded.
 *
 * The board needs the *catalogue*, not `host.plugins()`. The host only knows
 * what loaded, and a page that lists only those cannot show the one you just
 * switched off — nor the one that failed to load, which until now was visible
 * nowhere in the UI at all.
 */
export interface PluginCandidate {
  /**
   * How settings name it. Knowable **without importing it**.
   *
   * A built-in by its manifest name; a declared one by the specifier written
   * in `config.yaml`. That asymmetry is not an oversight: a declared plugin's
   * name is only knowable after importing the module, and not importing it is
   * exactly what switching it off has to mean. The user's key is the string
   * the user typed.
   */
  readonly id: string
  readonly source: 'builtin' | 'scope' | 'unknown'
  /** Without it nothing parses or runs, so it has no switch. */
  readonly essential: boolean
  readonly enabled: boolean
  readonly scope?: ScopeKind
  readonly specifier?: string
  /** Known once it has loaded. Absent for a disabled or failed one. */
  readonly name?: string
  readonly version?: string
  readonly loaded: boolean
  readonly error?: string
}

/**
 * Everything Factory could load, in load order, with what is switched off
 * marked rather than missing.
 *
 * Built before anything is imported, which is what lets the loader skip a
 * disabled plugin instead of loading and ignoring it.
 */
export function pluginCatalogue(options: {
  readonly chain: ScopeChain
  readonly builtins: readonly FactoryPlugin[]
  readonly essential: readonly string[]
  readonly disabled: readonly string[]
}): PluginCandidate[] {
  const disabled = new Set(options.disabled)
  const essential = new Set(options.essential)
  const known = new Set<string>()

  const candidates: PluginCandidate[] = options.builtins.map((plugin) => {
    known.add(plugin.name)
    return {
      id: plugin.name,
      source: 'builtin' as const,
      essential: essential.has(plugin.name),
      // An essential plugin is never off, however the file was edited by hand.
      enabled: essential.has(plugin.name) || !disabled.has(plugin.name),
      name: plugin.name,
      version: plugin.version,
      loaded: false,
    }
  })

  for (const declaration of declaredPlugins(options.chain)) {
    known.add(declaration.specifier)
    candidates.push({
      id: declaration.specifier,
      source: 'scope',
      essential: false,
      enabled: !disabled.has(declaration.specifier),
      scope: declaration.scope.kind,
      specifier: declaration.specifier,
      loaded: false,
    })
  }

  // An id switched off that nothing claims any more — a plugin removed from
  // config, or a settings file shared with another machine. It stays: never
  // prune somebody's file behind their back. Listed so the switch that turns
  // it back on is somewhere a person can reach.
  for (const id of options.disabled) {
    if (known.has(id)) continue
    candidates.push({ id, source: 'unknown', essential: false, enabled: false, loaded: false })
  }

  return candidates
}

/**
 * Load exactly the enabled ones, and record what happened to each.
 *
 * Nothing throws for a *declared* plugin, for the reason below. A built-in that
 * throws is a build bug and still crashes: there is no configuration to fix and
 * no diagnosis to print.
 */
export async function loadCatalogue(options: {
  readonly catalogue: readonly PluginCandidate[]
  readonly host: CapabilityHost
  readonly chain: ScopeChain
  /** Built-ins by id, since a catalogue entry carries no code. */
  readonly builtins: ReadonlyMap<string, FactoryPlugin>
}): Promise<{ catalogue: PluginCandidate[]; problems: Problem[] }> {
  const settled: PluginCandidate[] = []
  const problems: Problem[] = []
  const declarations = new Map(
    declaredPlugins(options.chain).map((entry) => [entry.specifier, entry]),
  )

  for (const candidate of options.catalogue) {
    if (!candidate.enabled || candidate.source === 'unknown') {
      settled.push(candidate)
      continue
    }

    if (candidate.source === 'builtin') {
      const plugin = options.builtins.get(candidate.id)
      if (plugin === undefined) {
        settled.push(candidate)
        continue
      }
      await options.host.load(plugin)
      settled.push({ ...candidate, loaded: true })
      continue
    }

    const declaration = declarations.get(candidate.id)
    if (declaration === undefined) {
      settled.push(candidate)
      continue
    }
    const where = resolvePath(declaration.scope.root, SCOPE_CONFIG_FILE)
    try {
      const plugin = await importPlugin(declaration.resolved)
      await options.host.load(plugin)
      settled.push({ ...candidate, name: plugin.name, version: plugin.version, loaded: true })
    } catch (error) {
      const message =
        `Could not load plugin "${candidate.id}" declared by the ` +
        `${declaration.scope.kind} scope: ${describe(error)}`
      settled.push({ ...candidate, error: describe(error) })
      problems.push({
        severity: 'error',
        message,
        file: where,
        field: 'plugins',
        rule: 'plugin.loadFailed',
      })
    }
  }

  return { catalogue: settled, problems }
}

async function importPlugin(specifier: string): Promise<FactoryPlugin> {
  const target = isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier
  const module = (await import(/* @vite-ignore */ target)) as Record<string, unknown>
  const candidate = module.default ?? module.plugin

  if (!isPlugin(candidate)) {
    throw new Error(
      'the module has no Factory plugin export — expected a default export with ' +
        'name, version and register',
    )
  }
  return candidate
}

function isPlugin(value: unknown): value is FactoryPlugin {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<FactoryPlugin>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'string' &&
    typeof candidate.register === 'function'
  )
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
