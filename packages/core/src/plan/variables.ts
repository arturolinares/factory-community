import type { Problem } from '../problems.js'

/**
 * `{{ namespace.key }}` substitution.
 *
 * The prototype left an unresolved token in place and carried on, so a typo in
 * `{{ task.nmae }}` was passed verbatim to the shell and the command quietly
 * did the wrong thing. Silence is the wrong default for a mistake nobody can
 * see.
 *
 * But erroring on every unknown token is wrong too: a prompt may legitimately
 * contain braces, and a workflow may reference a namespace a plugin provides.
 * So the rule is narrower and, I think, right: an unknown *key* inside a
 * namespace Factory owns is a warning that names the token, while an unknown
 * namespace is left alone.
 */

const TOKEN = /\{\{\s*([A-Za-z_][\w-]*)\.([\w-]+)\s*\}\}/g

export interface VariableScope {
  readonly [namespace: string]: Readonly<Record<string, string>> | undefined
}

export interface SubstitutionResult {
  readonly text: string
  readonly problems: readonly Problem[]
}

export function substitute(
  text: string,
  scope: VariableScope,
  where: { field?: string; file?: string } = {},
): SubstitutionResult {
  const problems: Problem[] = []

  const result = text.replace(TOKEN, (match, namespace: string, key: string) => {
    const bucket = scope[namespace]
    // A namespace Factory does not own is left exactly as written -- it may be
    // meant for whoever reads the string next.
    if (bucket === undefined) return match

    const value = bucket[key]
    if (value === undefined) {
      const known = Object.keys(bucket).sort()
      problems.push({
        severity: 'warning',
        message:
          `"${match}" does not resolve — "${namespace}" has no "${key}". ` +
          (known.length > 0 ? `Available: ${known.join(', ')}.` : `It has no values here.`),
        ...(where.file === undefined ? {} : { file: where.file }),
        ...(where.field === undefined ? {} : { field: where.field }),
        rule: 'variables.unknownKey',
      })
      return match
    }
    return value
  })

  return { text: result, problems }
}

/** Substitute through every string in a value, leaving structure intact. */
export function substituteDeep<T>(
  value: T,
  scope: VariableScope,
  where: { field?: string; file?: string } = {},
): { value: T; problems: Problem[] } {
  const problems: Problem[] = []

  const walk = (input: unknown, path: string): unknown => {
    if (typeof input === 'string') {
      const result = substitute(input, scope, { ...where, field: path })
      problems.push(...result.problems)
      return result.text
    }
    if (Array.isArray(input)) return input.map((entry, index) => walk(entry, `${path}.${index}`))
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, entry]) => [
          key,
          walk(entry, path === '' ? key : `${path}.${key}`),
        ]),
      )
    }
    return input
  }

  return { value: walk(value, where.field ?? '') as T, problems }
}
