/**
 * How much authority an agent gets.
 *
 * Factory runs other people's coding agents, and until now it ran all of them
 * the same way: `provider-claude` passed `--permission-mode bypassPermissions`
 * and `provider-copilot` passed `--allow-all-paths`, which switches off that
 * CLI's own path checking. Every run was unrestricted and nothing said so.
 *
 * Two profiles, because two is the number of genuinely different answers to
 * "may this agent touch things outside the project?" — no, and yes. Everything
 * finer (network, databases, per-resource grants) is a *refinement of the
 * first*, and inventing the general case before the first one is honest would
 * be the over-engineering `PLAN.md` warns about.
 *
 * A profile is data, not a capability. What *enforces* it is partly the
 * provider (see `permissionArgs`) and partly Factory (the workspace boundary,
 * the filtered environment, the process group), and a future sandbox
 * capability can add to it without core learning a new concept.
 */
export const EXECUTION_PROFILES = ['default', 'full-access'] as const

export type ExecutionProfile = (typeof EXECUTION_PROFILES)[number]

/**
 * What an installation does when nobody has said otherwise.
 *
 * Named rather than repeated, because "the default is default" is written in
 * four places — the settings schema, the project column, the resolver and the
 * renderer — and a literal in each is four chances to disagree.
 */
export const DEFAULT_PROFILE: ExecutionProfile = 'default'

/**
 * What to call each one to a person.
 *
 * Here rather than in the board, because the CLI, the web app and the docs all
 * name these, and a profile that reads "Full Access" in one place and
 * "full-access" in another is a profile somebody will think is two.
 */
export const EXECUTION_PROFILE_LABELS: Record<ExecutionProfile, string> = {
  default: 'Default',
  'full-access': 'Full Access',
}

/** Whether a string off the wire is a profile. Routes need this before storing one. */
export function isExecutionProfile(value: unknown): value is ExecutionProfile {
  return typeof value === 'string' && (EXECUTION_PROFILES as readonly string[]).includes(value)
}

/**
 * Which profile applies, in one place.
 *
 * Project, then installation, then `default`. The order matters and is the only
 * thing this function is for: the alternative is every caller writing
 * `project.profile ?? settings.security.profile ?? 'default'`, and the fourth
 * one writing it in a different order.
 *
 * Absence means "not stated", never "restricted" or "unrestricted" — which is
 * why a project with no profile inherits rather than defaulting separately.
 */
export function resolveProfile(sources: {
  readonly project?: ExecutionProfile | undefined
  readonly installation?: ExecutionProfile | undefined
}): ExecutionProfile {
  return sources.project ?? sources.installation ?? DEFAULT_PROFILE
}

/** Whether this profile confines the agent at all. */
export const isConfined = (profile: ExecutionProfile): boolean => profile !== 'full-access'
