/**
 * The capability model.
 *
 * Editions are not forks of this codebase. Core defines contracts; anything
 * else -- a first-party plugin, a third-party package, or Xaedalon Factory Pro
 * -- provides them through one public SDK. Core asks the host whether a
 * capability is present and degrades by *absence*; it has no `edition` concept,
 * no licence check, and no branch on who is running.
 *
 * Capability kinds are deliberately OPEN. If core had to declare every kind,
 * Pro's `desktop` capability would require a core change -- which is precisely
 * the coupling this design exists to prevent. Core types the kinds it consumes
 * itself; everything else is opaque to core and fully usable by whoever
 * defined it.
 */

/** Kinds core itself consumes. Listed for autocomplete and docs, not to restrict. */
export type WellKnownCapabilityKind =
  /** An agent CLI: model roles, command rendering, availability. (step 6) */
  | 'provider'
  /** A kind of work a phase step can do; the `uses:` key. (step 3) */
  | 'step-kind'
  /** A check `factory doctor` runs. (step 8) */
  | 'doctor-rule'
  /** Something still to be done before Factory is usable. (step 8) */
  | 'setup-step'
  /**
   * Opening a terminal where a task's work is. (step 14)
   *
   * Contracted here and consumed by the daemon rather than by core itself,
   * because starting a terminal application is the one thoroughly
   * platform-specific act in Factory and Community contains no platform
   * detection at all.
   */
  | 'terminal'
  /**
   * Something you can do to a task, drawn as a button on its page. (step 16)
   *
   * A tool returns a directory and argv and never performs anything itself,
   * so the same one works where a terminal can be opened and where it cannot.
   */
  | 'task-tool'

/**
 * Any capability kind. The union with `string & {}` keeps editor autocomplete
 * for the well-known kinds while still accepting one core has never heard of.
 */
export type CapabilityKind = WellKnownCapabilityKind | (string & {})

/**
 * Everything a capability must have. Contributions are keyed by (kind, id), so
 * the id is how a workflow names a provider (`provider: claude`) or a step
 * names its kind (`uses: agent`).
 */
export interface Capability {
  /** Unique within its kind. Lowercase slug, so it is safe in YAML and in a URL. */
  readonly id: string
  /** Shown in `factory capabilities` and in the builder's dropdowns. */
  readonly displayName?: string
  /** One line, for help output. */
  readonly summary?: string
}

/** A capability plus where it came from -- needed to explain conflicts. */
export interface RegisteredCapability<C extends Capability = Capability> {
  readonly kind: CapabilityKind
  readonly capability: C
  /** Name of the plugin that provided it. */
  readonly plugin: string
}

export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Raised when a plugin is malformed or conflicts with one already loaded. */
export class CapabilityError extends Error {
  override readonly name = 'CapabilityError'
  constructor(
    message: string,
    readonly detail: { plugin?: string; kind?: CapabilityKind; id?: string } = {},
  ) {
    super(message)
  }
}
