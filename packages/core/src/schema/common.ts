import { z } from 'zod'
import type { Problem } from '../problems.js'

/**
 * Shared schema pieces, and the bridge from zod's issues to Factory's Problem.
 *
 * The point of this file is that a mistake in a YAML file produces a message a
 * person can act on, naming the field they typed. xfactory had no schema at
 * all: `type: banana` was cast straight to the union type and silently kept, an
 * unknown key was ignored, and an agent block missing its prompt was dropped so
 * the phase ran nothing and reported success.
 */

/** Ids that appear in YAML, in file names, and in URLs. */
export const SLUG = /^[a-z][a-z0-9-]*$/

export const slug = (what: string) =>
  z
    .string()
    .min(1, `${what} is required`)
    .regex(SLUG, `${what} must be lowercase letters, digits and hyphens, starting with a letter`)

/** Template variables. Values are strings because they are substituted into commands. */
export const variables = z.record(z.string(), z.string())

/** Extension fields are namespaced and preserved verbatim, never validated. */
export const EXTENSION_PREFIX = 'x-'

export const isExtensionKey = (key: string): boolean => key.startsWith(EXTENSION_PREFIX)

/**
 * Reject unknown keys, but keep `x-` extension fields.
 *
 * Done by hand rather than with `.strict()` so the error can name the valid
 * keys and suggest the one the user probably meant -- a config file is edited
 * far more often than it is written, and "unknown key: phasez" without a
 * suggestion sends people to the docs for a typo.
 */
export function closedWithExtensions<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape))
  return z
    .object(shape)
    .catchall(z.unknown())
    .superRefine((value, ctx) => {
      for (const key of Object.keys(value)) {
        if (known.has(key) || isExtensionKey(key)) continue
        const suggestion = nearest(key, [...known])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: suggestion
            ? `Unknown field "${key}". Did you mean "${suggestion}"?`
            : `Unknown field "${key}". Valid fields: ${[...known].sort().join(', ')}. ` +
              `Use an "${EXTENSION_PREFIX}" prefix for data Factory should carry but not interpret.`,
        })
      }
    })
}

/** Pull the `x-` fields out of a parsed object so they can be carried through. */
export function extensionsOf(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => isExtensionKey(key)))
}

/** Turn zod's issues into Problems the CLI, daemon and builder all render alike. */
export function problemsFromZod(
  error: z.ZodError,
  context: { file?: string; prefix?: readonly (string | number)[] } = {},
): Problem[] {
  return error.issues.map((issue) => {
    const path = [...(context.prefix ?? []), ...issue.path] as (string | number)[]
    const field = path.length > 0 ? path.join('.') : undefined
    return {
      severity: 'error',
      message: hint(issue),
      ...(context.file === undefined ? {} : { file: context.file }),
      ...(field === undefined ? {} : { field, path }),
      rule: `schema.${issue.code}`,
    } satisfies Problem
  })
}

/**
 * Add a hint where zod's own wording leaves the user guessing.
 *
 * The common one: YAML resolves `run: 1.0` to a number and `artifact: 2026-01-01`
 * to a date, so a field the user believes is text arrives as something else.
 * "expected string, received number" is true but unhelpful; naming the fix is
 * the difference between a five-second correction and a puzzled search.
 */
function hint(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.expected === 'string') {
    const received = 'received' in issue ? String(issue.received) : 'another type'
    if (received !== 'undefined') {
      return `${issue.message} — YAML read this as ${received}; wrap the value in quotes to keep it text`
    }
  }
  return issue.message
}

/** Levenshtein distance, capped: only close matches are worth suggesting. */
function nearest(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  const limit = Math.max(2, Math.floor(input.length / 3))
  for (const candidate of candidates) {
    const distance = editDistance(input, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return bestDistance <= limit ? best : undefined
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}
