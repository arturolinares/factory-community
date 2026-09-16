import { z } from 'zod'
import { closedWithExtensions, slug } from '../schema/common.js'
import { MODEL_ROLES } from '../builtins/steps.js'

/**
 * A provider is a descriptor, not a class.
 *
 * Adding support for a new coding agent should be a YAML file, not a code
 * change — which is what provider independence has to mean, and what makes
 * the `generic-cli` story real rather than aspirational. All three
 * built-in providers are descriptors handed to one renderer.
 *
 * It also puts model ids where they belong: in data. They move faster than
 * releases — GitHub retired a set of Copilot ids mid-2026 and the CLI hard-errors
 * on a stale one — so a fix has to be a one-line edit to a file, not a rebuild.
 */

/**
 * What a provider can do. A workflow can then be checked against it before it
 * runs, so "this phase needs to resume a session and this agent cannot" is a
 * `doctor` warning rather than a confusing failure halfway through a run.
 */
export const PROVIDER_FEATURES = [
  'non_interactive',
  'session_resume',
  'streaming',
  'tool_use',
  'file_access',
  'mcp',
  'structured_output',
] as const
export type ProviderFeature = (typeof PROVIDER_FEATURES)[number]

/** How a provider is told to carry context between steps. */
export const SESSION_MODES = ['continue', 'id', 'none'] as const
export type SessionMode = (typeof SESSION_MODES)[number]

const descriptorShape = {
  kind: z.literal('factory.provider/v1').optional(),
  id: slug('id'),
  displayName: z.string().min(1),
  summary: z.string().default(''),
  /** The executable. Looked up on PATH unless it is an absolute path. */
  command: z.string().min(1),
  /**
   * How a person installs this agent, and where its documentation is.
   *
   * Data, like the flags, and for the same reason: an install command changes
   * when a vendor renames a package, and that should be an edit to a YAML file
   * rather than a release. Both are optional — a descriptor that does not know
   * is better than one that guesses.
   */
  install: z.string().min(1).optional(),
  docs: z.string().min(1).optional(),
  supports: z.array(z.enum(PROVIDER_FEATURES)).default([]),
  /** Role to concrete model id. Roles keep a phase portable across a rename. */
  models: z.record(z.enum(MODEL_ROLES), z.string().min(1)),

  /** Omit to pass the prompt positionally. */
  promptFlag: z.string().min(1).optional(),
  modelFlag: z.string().min(1).optional(),
  effortFlag: z.string().min(1).optional(),
  /**
   * The values `effortFlag` accepts.
   *
   * Declared by the provider rather than assumed by Factory, because they are
   * that CLI's vocabulary and nobody else's. Empty — the default — means the
   * builder offers no list, which is also the honest answer for a provider
   * with no effort flag at all.
   */
  effortValues: z.array(z.string().min(1)).default([]),
  subagentFlag: z.string().min(1).optional(),

  session: z
    .object({
      mode: z.enum(SESSION_MODES).default('none'),
      /** Used when mode is "continue": resume the most recent session here. */
      continueArgs: z.array(z.string()).default([]),
      /**
       * Used when mode is "id": start a session with an id Factory chose.
       *
       * Factory minting the id is what lets it be resumed exactly — by a later
       * phase, by a re-run, and by a person opening a terminal — rather than
       * by "the most recent conversation here", which is wrong the moment two
       * tasks share a directory.
       */
      idFlag: z.string().min(1).optional(),
      /**
       * Used when mode is "id": resume the session with that id.
       *
       * Defaults to `idFlag`, which is right for a CLI whose one flag both
       * sets and resumes. Claude Code needs both: `--session-id` refuses an id
       * that already exists ("Session ID … is already in use") and `--resume`
       * refuses one that does not, so the two are genuinely different verbs and
       * a descriptor that could only say one of them could not resume at all.
       */
      resumeFlag: z.string().min(1).optional(),
    })
    .default({ mode: 'none', continueArgs: [] }),

  /** Whatever the CLI needs to run unattended. */
  permissionArgs: z.array(z.string()).default([]),
  extraArgs: z.array(z.string()).default([]),
  /** Redirected into stdin. Several CLIs hang without this when headless. */
  stdin: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).default({}),
  /**
   * Environment variables this CLI needs even under a confined profile.
   *
   * The Default profile withholds anything shaped like a credential, and a
   * coding agent's own credential is shaped exactly like one — filter
   * `ANTHROPIC_API_KEY` and every Claude run fails at once. Declared here,
   * beside the flags, so a new provider brings its own answer instead of
   * editing a list inside core.
   *
   * Names only. Factory never reads the values; it decides whether to pass them
   * through. And a subscription login keeps its credential in a keychain rather
   * than the environment, so a short list here is not evidence of a problem.
   */
  passEnv: z.array(z.string().min(1)).default([]),

  /**
   * True when this descriptor has not been checked against the real CLI.
   * `doctor` says so out loud rather than letting someone discover it when a
   * run fails with an unrecognised flag.
   */
  provisional: z.boolean().default(false),
  /** Why it is provisional, and how to verify it. */
  provisionalNote: z.string().optional(),
}

const descriptorSchema = closedWithExtensions(descriptorShape)

export type ProviderDescriptor = z.infer<typeof descriptorSchema>

export const providerDescriptorKeys: readonly string[] = Object.keys(descriptorShape)

export function parseProviderDescriptor(
  input: unknown,
): { descriptor?: ProviderDescriptor; error?: z.ZodError } {
  const parsed = descriptorSchema.safeParse(input)
  return parsed.success ? { descriptor: parsed.data } : { error: parsed.error }
}
