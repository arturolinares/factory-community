/**
 * A problem found while validating something.
 *
 * One shared vocabulary for every producer — the schema, hooks, doctor rules,
 * the YAML parser — so the CLI, the daemon and the builder's error list all
 * render the same shape. xfactory had no such type: validation either threw an
 * opaque Error or silently substituted a default, which is why `type: banana`
 * passed and an agent block with no prompt vanished without a word.
 */
export interface Problem {
  severity: ProblemSeverity
  /** Human-readable, and specific. "expected one of once|loop, got 'banana'". */
  message: string
  /** Absolute path of the file the problem is in, when it came from a file. */
  file?: string
  /** 1-based position within that file. Sourced from the YAML parser's linePos. */
  at?: { line: number; column: number }
  /** Dotted path to the offending field, e.g. "steps.2.prompt". For display. */
  field?: string
  /**
   * The same path, structured. Used to find the node in the YAML document so a
   * line and column can be attached, and later by the builder to focus the
   * offending form control. Kept separate from `field` because an extension key
   * may itself contain a dot.
   */
  path?: readonly (string | number)[]
  /** Which rule produced this, for suppression and for `doctor --explain`. */
  rule?: string
}

export type ProblemSeverity = 'error' | 'warning'

export const isError = (problem: Problem): boolean => problem.severity === 'error'

/** True when nothing in the list blocks the operation. Warnings do not block. */
export const isClean = (problems: readonly Problem[]): boolean => !problems.some(isError)

/** Render one problem the way the CLI prints it. */
export function formatProblem(problem: Problem): string {
  const where = problem.file
    ? problem.at
      ? `${problem.file}:${problem.at.line}:${problem.at.column}`
      : problem.file
    : undefined
  const parts = [
    where,
    problem.severity,
    problem.field ? `${problem.field}:` : undefined,
    problem.message,
    problem.rule ? `(${problem.rule})` : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.join(' ')
}
