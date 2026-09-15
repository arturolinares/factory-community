import type { Capability, CapabilityLookup } from './index.js'

/**
 * What is still missing before Factory can do anything useful.
 *
 * Doctor answers "is anything wrong?" — a question you ask an installation that
 * already works. This answers "what do I still need to do?", which is the
 * question on the first day, and it is a different list: no agent installed is
 * not a fault, it is a step nobody has taken yet.
 *
 * A registry rather than a fixed checklist, for the usual reason. A provider
 * plugin knows how its agent is installed; the engine knows whether a project
 * has been added; Pro knows whether it is licensed. Each contributes its own
 * step, and a third party shipping a plugin with setup of its own — an API
 * token, a daemon of their own to start — appears in the same list without
 * anybody editing it.
 */

export const SETUP_STEP_KIND = 'setup-step'

/** Something a person can do about a step that is not done. */
export interface SetupAction {
  readonly label: string
  /** A command to run in a terminal. */
  readonly command?: string
  /** Configuration to add, as it should be written. */
  readonly config?: string
  /** Where to read more. */
  readonly url?: string
}

export interface SetupState {
  readonly done: boolean
  /** What is true right now, in a sentence. */
  readonly detail?: string
  /** Ways to finish it. Empty when it is done. */
  readonly actions?: readonly SetupAction[]
  /**
   * Whether the rest of Factory is unusable until this is done.
   *
   * Only two things qualify: somewhere to work, and something to work with.
   * Everything else is an improvement, and a checklist that treats them alike
   * teaches people to ignore it.
   */
  readonly essential?: boolean
}

export interface SetupStepCapability extends Capability {
  readonly title: string
  readonly summary: string
  /** Lower runs and lists first. Defaults to 100. */
  readonly order?: number
  check(context: SetupContext): SetupState | Promise<SetupState>
}

/** What a step is given. Whatever a step needs beyond this, it closes over. */
export interface SetupContext {
  readonly host: CapabilityLookup
  readonly env: Readonly<Record<string, string | undefined>>
}

export interface SetupItem extends SetupState {
  readonly id: string
  readonly title: string
  readonly summary: string
}

export interface SetupReport {
  readonly items: readonly SetupItem[]
  /** Nothing essential is outstanding. Improvements may still be. */
  readonly ready: boolean
  readonly remaining: number
}

/**
 * Run every registered step.
 *
 * A step that throws is reported as not done, with the error as its detail —
 * the same rule doctor follows. A checklist that disappears because one plugin
 * misbehaved is worse than one with an ugly entry in it.
 */
export async function runSetup(context: SetupContext): Promise<SetupReport> {
  const steps = context.host
    .list<SetupStepCapability>(SETUP_STEP_KIND)
    .map((entry) => entry.capability)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

  const items: SetupItem[] = []
  for (const step of steps) {
    const base = { id: step.id, title: step.title, summary: step.summary }
    try {
      items.push({ ...base, ...(await step.check(context)) })
    } catch (error) {
      items.push({
        ...base,
        done: false,
        detail: `This check failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return {
    items,
    ready: items.every((item) => item.done || item.essential !== true),
    remaining: items.filter((item) => !item.done).length,
  }
}
