import { z } from 'zod'
import type { CapabilityLookup } from '../host.js'
import type { Problem } from '../problems.js'
import { closedWithExtensions, extensionsOf, problemsFromZod, slug, variables } from './common.js'
import { parseSteps, type Step } from './step.js'

/**
 * A phase: an ordered list of steps, optionally gated on human approval.
 */

export const PHASE_KIND = 'factory.phase/v1'

/**
 * Whether a human is asked about this phase, and when.
 *
 * The prototype called this `type: auto | inspect`. "inspect" described what the
 * operator does, not what Factory does, and "type" said nothing at all.
 *
 * `required` said only *whether*, and there are two different questions people
 * want to ask:
 *
 * - **`before`** — an *authorisation* gate. Ask, then run. For a phase that
 *   deploys, deletes or lets an agent loose on the repository, where the point
 *   is that it does not happen until somebody says so.
 * - **`after`** — a *review* gate. Run, collect what the phase produced, then
 *   ask before anything downstream acts on it. This is what makes evidence at a
 *   gate worth having: the artifact is on screen when you decide.
 *
 * `required` is still accepted and means `after`, which is what every file
 * written before this existed already did. Silently flipping those to `before`
 * would have fired their gates before the artifact they exist to show you.
 */
export const APPROVAL = ['none', 'before', 'after'] as const
export type Approval = (typeof APPROVAL)[number]

/** What `approval: required` used to be spelled. Read, never written. */
export const LEGACY_APPROVAL = 'required'

const phaseShape = {
  kind: z.literal(PHASE_KIND).optional(),
  name: slug('name'),
  description: z.string().default(''),
  approval: z.enum(APPROVAL).default('none'),
  // No `artifact` here any more; it belongs to the agent step that writes it.
  // A phase declaring one could only say "something in here produces this" — not
  // which step, and so not which agent to tell. On the step, both are obvious.
  /**
   * Working directory for every step, relative to the resolved workspace.
   *
   * Documented in the prototype's README and parsed by nothing, so it silently did
   * nothing for anyone who used it. Implemented here.
   */
  working_dir: z.string().min(1).optional(),
  variables: variables.default({}),
  steps: z.array(z.unknown()).default([]),
}

const phaseYaml = closedWithExtensions(phaseShape)

/** The keys this schema accepts, derived. Checked against PHASE_FIELDS. */
export const phaseSchemaKeys: readonly string[] = Object.keys(phaseShape)

export interface Phase {
  /** Present only when the file declared it; carried so a save cannot drop it. */
  readonly kind?: typeof PHASE_KIND
  readonly name: string
  readonly description: string
  readonly approval: Approval
  readonly workingDir?: string
  readonly variables: Readonly<Record<string, string>>
  readonly steps: readonly Step[]
  readonly extensions: Readonly<Record<string, unknown>>
}

export interface PhaseParseResult {
  readonly phase?: Phase
  readonly problems: readonly Problem[]
}

/**
 * Parse a phase.
 *
 * Needs the host because step validity depends on which step kinds are
 * installed -- see schema/step.ts. A phase using `uses: http` is valid with
 * that plugin present and invalid without it, and the error says which.
 */
export function parsePhase(
  input: unknown,
  host: CapabilityLookup,
  options: { file?: string } = {},
): PhaseParseResult {
  const parsed = phaseYaml.safeParse(withLegacyApproval(input))
  if (!parsed.success) {
    return {
      problems: problemsFromZod(parsed.error, {
        ...(options.file === undefined ? {} : { file: options.file }),
      }),
    }
  }

  const value = parsed.data as z.infer<typeof phaseYaml> & Record<string, unknown>
  const stepResult = parseSteps(value.steps, host, {
    ...(options.file === undefined ? {} : { file: options.file }),
  })
  const problems: Problem[] = [...stepResult.problems]

  if (value.steps.length === 0) {
    problems.push({
      severity: 'warning',
      message: 'Phase has no steps, so it will do nothing',
      ...(options.file === undefined ? {} : { file: options.file }),
      field: 'steps',
      rule: 'phase.noSteps',
    })
  }

  // A step problem means the phase is not usable, so do not hand back a phase
  // with silently-missing steps -- that is exactly the shape of the bug this
  // schema exists to prevent.
  if (stepResult.problems.some((problem) => problem.severity === 'error')) {
    return { problems }
  }

  const phase: Phase = {
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    name: value.name,
    description: value.description,
    approval: value.approval,
    ...(value.working_dir === undefined ? {} : { workingDir: value.working_dir }),
    variables: value.variables,
    steps: stepResult.steps,
    extensions: extensionsOf(value),
  }

  return { phase, problems }
}

/**
 * Rewrite `approval: required` to `approval: after`.
 *
 * Done here rather than in the schema so that `APPROVAL` stays three values:
 * the builder renders its dropdown from the generated JSON Schema, and a fourth
 * option meaning the same as one of the others is a question with two right
 * answers. Reading it costs one line; offering it would cost every person who
 * opens the form.
 */
function withLegacyApproval(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input
  const value = input as Record<string, unknown>
  if (value['approval'] !== LEGACY_APPROVAL) return input
  return { ...value, approval: 'after' }
}
