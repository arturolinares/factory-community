/**
 * Noticing that an agent was refused something.
 *
 * The Default profile confines an agent by handing its CLI the flags that
 * confine it. That works — it was measured — but it moves the refusal *inside*
 * the agent, where Factory cannot see it. The plan for this increment assumed a
 * refusal would fail the step, and running the real CLI showed otherwise:
 * `claude -p` **exits 0** and reports the refusal in prose. The step succeeds,
 * the run completes, and the work did not happen.
 *
 * So there are two cases and they deserve different answers:
 *
 * - **The step failed and a denial matched.** It was going to block the task
 *   anyway. Pausing it instead is strictly better: the run keeps its place, the
 *   person is told what was refused, and approving continues from the failing
 *   phase rather than the beginning.
 * - **The step succeeded and a denial matched.** Interrupting here would be
 *   wrong — the run may have done everything that mattered, and "minimum
 *   process interruption" is the point of the profile. It is recorded and shown
 *   instead, so nobody has to find out by reading a transcript.
 *
 * Patterns are data on the provider descriptor, because what a refusal looks
 * like is that CLI's business and a third-party provider must be able to say so
 * without a core change.
 */

/** What a refusal looks like, as one provider words it. */
export interface DenialPattern {
  /** Names the kind of refusal, for a message and for a grant. */
  readonly id: string
  /**
   * A plain substring that must be present before the expression is tried.
   *
   * Load-bearing for performance, not convenience, and it was added after the
   * first implementation hung the test suite. A pattern like `(\\S+) is
   * outside …` run against a long run of non-whitespace — which is what an
   * agent's output looks like when it prints data — backtracks catastrophically:
   * the engine tries every start position at every length. 200 KB of it was
   * enough to stop the process.
   *
   * So the search is a cheap `indexOf` over the whole buffer, and the
   * expression only ever runs on a small window around a hit. Required rather
   * than optional, because a third-party pattern without one would be the same
   * trap with somebody else's name on it.
   */
  readonly contains: string
  /**
   * A regular expression, as a string.
   *
   * A string rather than a `RegExp` because it arrives from YAML. Compiled
   * fresh per scan, so no `lastIndex` state can leak between steps.
   *
   * A first capture group, if present, is taken to be the path that was
   * refused — which is the one piece of a refusal Factory can act on, because
   * a directory is exactly what it can grant.
   */
  readonly match: string
  /** Shown to a person. The pattern itself is not an explanation. */
  readonly describe: string
}

/** A refusal that actually happened. */
export interface Denial {
  readonly id: string
  readonly describe: string
  /** The path it was refused, when the pattern caught one. */
  readonly path?: string
  /** The line it was found in, trimmed. Evidence, so nobody has to trust this. */
  readonly evidence: string
}

/**
 * How much of the previous chunk is kept, so a refusal split across two pieces
 * of a pipe is still found.
 *
 * Only as long as a message plausibly is, not as long as the output: the
 * straddle problem needs an *overlap*, and the first implementation kept a
 * 64 KiB rolling tail and rescanned all of it every chunk, which is how it
 * turned quadratic.
 */
export const DENIAL_OVERLAP_BYTES = 2 * 1024

/** How much text around a hit the expression is allowed to see. */
export const DENIAL_WINDOW_BYTES = 512

/**
 * Collects output and reports the refusals in it.
 *
 * Stateful and per-step, so a scenario can drive it one chunk at a time and the
 * runner can feed it a pipe. Each pattern is reported at most once: an agent
 * that is refused eleven times has one problem, not eleven.
 */
export class DenialScanner {
  readonly #patterns: readonly DenialPattern[]
  readonly #found = new Map<string, Denial>()
  #tail = ''

  constructor(patterns: readonly DenialPattern[] = []) {
    this.#patterns = patterns
  }

  /** Nothing to look for, so nothing to do. Lets a caller skip the work. */
  get idle(): boolean {
    return this.#patterns.length === 0
  }

  push(chunk: string): void {
    if (this.idle) return
    // The overlap plus the new chunk, so a message spanning the boundary is
    // still found — and only the overlap, so the cost is in the chunk rather
    // than in everything that came before it.
    const text = this.#tail + chunk

    for (const pattern of this.#patterns) {
      if (this.#found.has(pattern.id)) continue

      // Cheap first. `indexOf` over a megabyte is nothing; the expression over
      // a megabyte of non-whitespace does not finish.
      const at = text.indexOf(pattern.contains)
      if (at < 0) continue

      let expression: RegExp
      try {
        expression = new RegExp(pattern.match, 'm')
      } catch {
        // A descriptor with an unparseable pattern is a descriptor problem, not
        // a reason to lose the run. This carries on; the others still run.
        continue
      }

      const window = text.slice(
        Math.max(0, at - DENIAL_WINDOW_BYTES),
        at + pattern.contains.length + DENIAL_WINDOW_BYTES,
      )
      const hit = expression.exec(window)
      if (hit === null) continue
      const captured = hit[1]
      this.#found.set(pattern.id, {
        id: pattern.id,
        describe: pattern.describe,
        ...(captured === undefined || captured === '' ? {} : { path: captured }),
        evidence: (hit[0] ?? '').trim().slice(0, 300),
      })
    }

    this.#tail =
      text.length > DENIAL_OVERLAP_BYTES ? text.slice(-DENIAL_OVERLAP_BYTES) : text
  }

  /** What was refused, in the order the patterns are declared. */
  denials(): readonly Denial[] {
    return [...this.#found.values()]
  }
}

/**
 * What to tell a person about a refusal.
 *
 * One wording, because this reaches the task board, the run detail and the
 * CLI. It names the remedy when there is one, because a refusal a person cannot
 * act on is just bad news.
 */
export function denialMessage(denial: Denial): string {
  const remedy =
    denial.path === undefined
      ? 'Allow it for this project, or run this project under Full Access.'
      : `Allow "${denial.path}" for this project, or run this project under Full Access.`
  return `The agent was refused: ${denial.describe} ${remedy}`
}
