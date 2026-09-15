import { z } from 'zod'
import type { Problem } from '../problems.js'
import { closedWithExtensions, extensionsOf, problemsFromZod, slug } from './common.js'
import { SESSION_SCOPES, type SessionScope } from '../builtins/steps.js'

/**
 * An agent: a named set of the settings an agent step would otherwise repeat.
 *
 * Provider, model and effort were spelled out on every single step, so
 * answering "which model writes the code here" meant reading every phase, and
 * changing it meant editing every one. A named agent puts the answer in one
 * file that a step refers to — which is what the plan describes as
 * `agents: { developer: { provider: codex } }` and a step as `- agent: developer`.
 *
 * Deliberately not a provider. A provider is *what is installed*: a CLI, its
 * flags, how it renders a command. An agent is *how you want to use one* —
 * several agents can share a provider and differ only in model or persona.
 */

export const AGENT_KIND = 'factory.agent/v1'

const agentShape = {
  kind: z.literal(AGENT_KIND).optional(),
  name: slug('name'),
  description: z.string().default(''),
  /**
   * Which installed provider runs it.
   *
   * Optional, and falling back exactly the way a step's does: the configured
   * default, then the only one installed. An agent that says nothing about the
   * provider is still useful — it can pin a model role and a persona and let
   * the installation decide what executes them.
   */
  provider: slug('provider').optional(),
  /** A role — strong, balanced, fast — or a literal model id. */
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  /** A named sub-agent or persona, mapped per provider. */
  subagent: z.string().min(1).optional(),
  session: z.enum(SESSION_SCOPES).optional(),
  /** Extra arguments appended verbatim to the rendered command. */
  args: z.array(z.string()).optional(),
}

const agentYaml = closedWithExtensions(agentShape)

/** The keys this schema accepts, derived. Checked against AGENT_FIELDS. */
export const agentSchemaKeys: readonly string[] = Object.keys(agentShape)

export interface Agent {
  /** Present only when the file declared it; carried so a save cannot drop it. */
  readonly kind?: typeof AGENT_KIND
  readonly name: string
  readonly description: string
  readonly provider?: string
  readonly model?: string
  readonly effort?: string
  readonly subagent?: string
  readonly session?: SessionScope
  readonly args?: readonly string[]
  readonly extensions: Readonly<Record<string, unknown>>
}

export interface AgentParseResult {
  readonly agent?: Agent
  readonly problems: readonly Problem[]
}

/**
 * Parse an agent.
 *
 * No host, unlike a phase: an agent names a provider but does not have to be
 * installed to be written down. Whether that provider exists is a question for
 * plan time, where the error can say what *is* installed — the same answer a
 * step with an unknown provider already gets.
 */
export function parseAgent(input: unknown, options: { file?: string } = {}): AgentParseResult {
  const parsed = agentYaml.safeParse(input)
  if (!parsed.success) {
    return {
      problems: problemsFromZod(parsed.error, {
        ...(options.file === undefined ? {} : { file: options.file }),
      }),
    }
  }

  const value = parsed.data as z.infer<typeof agentYaml> & Record<string, unknown>
  const problems: Problem[] = []

  // Every field is optional, so an agent saying nothing parses cleanly and
  // contributes nothing. Worth a warning: it is far more likely to be a
  // half-written file than a deliberate one.
  if (
    value.provider === undefined &&
    value.model === undefined &&
    value.effort === undefined &&
    value.subagent === undefined &&
    value.session === undefined
  ) {
    problems.push({
      severity: 'warning',
      message:
        `Agent "${value.name}" sets nothing, so a step naming it behaves exactly as one that ` +
        `does not. Give it at least a provider or a model.`,
      ...(options.file === undefined ? {} : { file: options.file }),
      rule: 'agent.setsNothing',
    })
  }

  const agent: Agent = {
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    name: value.name,
    description: value.description,
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(value.effort === undefined ? {} : { effort: value.effort }),
    ...(value.subagent === undefined ? {} : { subagent: value.subagent }),
    ...(value.session === undefined ? {} : { session: value.session }),
    ...(value.args === undefined ? {} : { args: value.args }),
    extensions: extensionsOf(value),
  }

  return { agent, problems }
}
