import { EventBus } from '@factory/events'
import {
  CAPABILITY_ID_PATTERN,
  CapabilityError,
  type Capability,
  type CapabilityKind,
  type RegisteredCapability,
} from './capabilities.js'
import { HookRegistry, type HookHandler, type HookName } from './hooks.js'

/**
 * What a plugin is handed when it loads. This is the entire contract -- a
 * third-party package, the built-in step kinds, the provider plugins, and
 * Xaedalon Factory Pro all receive exactly this object and nothing more.
 *
 * If Pro ever needs something that is not reachable from here, the answer is to
 * widen this interface (so a third party gets it too), never to let Pro reach
 * into core. That is what keeps "commercial repositories add capabilities" true
 * rather than aspirational.
 */
export interface PluginContext {
  /** Contribute a capability. Kinds are open; core need not know this one. */
  provide<C extends Capability>(kind: CapabilityKind, capability: C): void
  /** Influence an operation while it runs. */
  hook<N extends HookName>(name: N, handler: HookHandler<N>): void
  /** React to facts. Cannot change them. */
  readonly events: EventBus
  /** Read-only view of what is already loaded, for a plugin that builds on another. */
  readonly host: CapabilityLookup
  /**
   * The environment this installation is running in.
   *
   * Handed over rather than read, for the same reason every other module here
   * receives it: a plugin that calls `process.env` cannot be tested against a
   * machine it is not running on, and the provider plugins have to answer
   * "where is this binary" differently on every machine.
   */
  readonly env: Readonly<Record<string, string | undefined>>
  /**
   * What the installation says about a capability this plugin is about to
   * provide — the `claude:` block under `providers:` in a scope's config, say.
   *
   * Machine-specific facts have to live somewhere a plugin's own data cannot:
   * a provider's descriptor ships inside the package and is identical on every
   * machine, but where the binary is differs between one Mac and the next. This
   * is that somewhere, and it is deliberately not provider-shaped — any
   * capability of any kind can be configured the same way.
   *
   * Returns undefined when nothing was configured, which is the ordinary case.
   */
  settings(kind: CapabilityKind, id: string): Readonly<Record<string, unknown>> | undefined
}

/** A plugin: a name, a version, and one function that registers everything. */
export interface FactoryPlugin {
  readonly name: string
  readonly version: string
  register(context: PluginContext): void | Promise<void>
}

/** The read side of the host. */
export interface CapabilityLookup {
  has(kind: CapabilityKind, id?: string): boolean
  get<C extends Capability = Capability>(kind: CapabilityKind, id?: string): C | undefined
  list<C extends Capability = Capability>(kind: CapabilityKind): RegisteredCapability<C>[]
  kinds(): CapabilityKind[]
  plugins(): { name: string; version: string }[]
}

/** Configuration for capabilities, by kind and then by capability id. */
export type CapabilitySettings = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
>

export interface CapabilityHostOptions {
  events?: EventBus
  /** Passed to every plugin. Defaults to empty, never to the ambient environment. */
  env?: Readonly<Record<string, string | undefined>>
  /**
   * Seeded before any plugin loads, because a plugin reads it while it
   * registers. Whoever builds the host has the scope chain and can resolve it;
   * the host itself knows nothing about files.
   */
  settings?: CapabilitySettings
}

export class CapabilityHost implements CapabilityLookup {
  readonly #byKind = new Map<CapabilityKind, Map<string, RegisteredCapability>>()
  readonly #loaded = new Map<string, { name: string; version: string }>()
  readonly hooks = new HookRegistry()
  readonly events: EventBus
  readonly #settings: CapabilitySettings
  readonly env: Readonly<Record<string, string | undefined>>

  constructor(options: CapabilityHostOptions = {}) {
    this.events = options.events ?? new EventBus()
    this.#settings = options.settings ?? {}
    this.env = options.env ?? {}
  }

  /** What the installation configured for one capability, if anything. */
  settings(kind: CapabilityKind, id: string): Readonly<Record<string, unknown>> | undefined {
    return this.#settings[kind]?.[id]
  }

  /**
   * Load a plugin. Registration is all-or-nothing: if any contribution is
   * rejected, nothing the plugin provided is kept. A half-registered plugin is
   * worse than an absent one, because the failure surfaces later and somewhere
   * unrelated.
   */
  async load(plugin: FactoryPlugin): Promise<void> {
    assertManifest(plugin)
    if (this.#loaded.has(plugin.name)) {
      throw new CapabilityError(`Plugin already loaded: ${plugin.name}`, { plugin: plugin.name })
    }

    const staged: RegisteredCapability[] = []
    const stagedHooks: Array<[HookName, unknown]> = []

    const context: PluginContext = {
      provide: (kind, capability) => {
        assertCapability(plugin.name, kind, capability)
        if (staged.some((entry) => entry.kind === kind && entry.capability.id === capability.id)) {
          throw new CapabilityError(
            `Plugin ${plugin.name} provides ${kind}:${capability.id} twice`,
            { plugin: plugin.name, kind, id: capability.id },
          )
        }
        const clash = this.#byKind.get(kind)?.get(capability.id)
        if (clash) {
          throw new CapabilityError(
            `${kind}:${capability.id} is already provided by ${clash.plugin}`,
            { plugin: plugin.name, kind, id: capability.id },
          )
        }
        staged.push({ kind, capability, plugin: plugin.name })
      },
      hook: (name, handler) => {
        stagedHooks.push([name, handler])
      },
      events: this.events,
      host: this,
      settings: (kind, id) => this.settings(kind, id),
      env: this.env,
    }

    await plugin.register(context)

    if (staged.length === 0 && stagedHooks.length === 0) {
      throw new CapabilityError(
        `Plugin ${plugin.name} registered nothing. A plugin that contributes no ` +
          `capability and no hook cannot affect anything, which is almost always a bug.`,
        { plugin: plugin.name },
      )
    }

    for (const entry of staged) {
      let bucket = this.#byKind.get(entry.kind)
      if (!bucket) {
        bucket = new Map()
        this.#byKind.set(entry.kind, bucket)
      }
      bucket.set(entry.capability.id, entry)
    }
    for (const [name, handler] of stagedHooks) {
      this.hooks.add(name, plugin.name, handler as never)
    }
    this.#loaded.set(plugin.name, { name: plugin.name, version: plugin.version })
  }

  async loadAll(plugins: readonly FactoryPlugin[]): Promise<void> {
    for (const plugin of plugins) await this.load(plugin)
  }

  /**
   * Is this capability present?
   *
   * This is the whole edition mechanism. Core calls `has('desktop')` and
   * degrades by absence -- it never asks which edition is running, and it has
   * no concept of a licence. Whether Pro registered its capability is Pro's
   * decision, made inside Pro.
   */
  has(kind: CapabilityKind, id?: string): boolean {
    const bucket = this.#byKind.get(kind)
    if (!bucket) return false
    return id === undefined ? bucket.size > 0 : bucket.has(id)
  }

  /** With no id, returns the single capability of that kind, if there is exactly one. */
  get<C extends Capability = Capability>(kind: CapabilityKind, id?: string): C | undefined {
    const bucket = this.#byKind.get(kind)
    if (!bucket) return undefined
    if (id !== undefined) return bucket.get(id)?.capability as C | undefined
    if (bucket.size !== 1) return undefined
    return [...bucket.values()][0]?.capability as C | undefined
  }

  list<C extends Capability = Capability>(kind: CapabilityKind): RegisteredCapability<C>[] {
    return [...(this.#byKind.get(kind)?.values() ?? [])] as RegisteredCapability<C>[]
  }

  kinds(): CapabilityKind[] {
    return [...this.#byKind.keys()].sort()
  }

  plugins(): { name: string; version: string }[] {
    return [...this.#loaded.values()]
  }
}

function assertManifest(plugin: FactoryPlugin): void {
  if (typeof plugin !== 'object' || plugin === null) {
    throw new CapabilityError('Plugin must be an object')
  }
  if (typeof plugin.name !== 'string' || plugin.name.trim() === '') {
    throw new CapabilityError('Plugin must have a non-empty name')
  }
  if (typeof plugin.version !== 'string' || plugin.version.trim() === '') {
    throw new CapabilityError(`Plugin ${plugin.name} must have a version`, { plugin: plugin.name })
  }
  if (typeof plugin.register !== 'function') {
    throw new CapabilityError(`Plugin ${plugin.name} must have a register function`, {
      plugin: plugin.name,
    })
  }
}

function assertCapability(plugin: string, kind: CapabilityKind, capability: Capability): void {
  if (typeof kind !== 'string' || kind.trim() === '') {
    throw new CapabilityError(`Plugin ${plugin} provided a capability with no kind`, { plugin })
  }
  if (typeof capability !== 'object' || capability === null) {
    throw new CapabilityError(`Plugin ${plugin} provided a non-object ${kind} capability`, {
      plugin,
      kind,
    })
  }
  if (!CAPABILITY_ID_PATTERN.test(capability.id ?? '')) {
    throw new CapabilityError(
      `Invalid ${kind} id from ${plugin}: ${JSON.stringify(capability.id)}. ` +
        `Ids must match ${CAPABILITY_ID_PATTERN} -- they appear in YAML and in URLs.`,
      { plugin, kind, id: capability.id },
    )
  }
}
