import type { Problem } from '../problems.js'

/**
 * Which workflows have to be in the list, given the ones you asked for.
 *
 * A workflow declares only its *immediate* predecessor — `verify` needs
 * `validate`, `validate` needs `implement` — and this walks the chain. Listing
 * the whole chain on every workflow would mean writing it once per stage and
 * repairing all of them the day a stage is inserted; the copies drift, and the
 * one nobody opens is the one that is wrong.
 *
 * One function rather than one per caller: the builder inserts what it returns,
 * doctor reports what it complains about, and if those two disagreed about what
 * `verify` needs, the builder would assemble a task doctor then calls broken.
 *
 * Pure, and takes its lookup as an argument, so it needs no scope chain and can
 * be tested without a filesystem.
 */

export interface NeedsResolution {
  /** Everything that must be in the list, predecessors before dependents. */
  readonly order: readonly string[]
  /** Names that were added to satisfy something else, in the order added. */
  readonly added: readonly string[]
  readonly problems: readonly Problem[]
}

/**
 * @param wanted  The list as it stands, in the order the person put it.
 * @param needsOf What a workflow declares. `undefined` for a name that resolves
 *                to nothing, which is reported rather than assumed empty.
 */
export function resolveNeeds(
  wanted: readonly string[],
  needsOf: (name: string) => readonly string[] | undefined,
): NeedsResolution {
  const problems: Problem[] = []
  const order: string[] = []
  const added: string[] = []
  const placed = new Set<string>()
  /** Names on the current descent, so a ring is caught rather than followed. */
  const visiting: string[] = []

  const place = (name: string, isWanted: boolean): void => {
    // A predecessor is added once; a name the person asked for lands every time
    // they asked for it. Duplicates in a task's list are deliberate — running
    // tests, fixing, then running them again is a plan, not a mistake — and
    // collapsing them here would quietly rewrite it.
    if (placed.has(name) && !isWanted) return

    const ring = visiting.indexOf(name)
    if (ring !== -1) {
      // Only here can a cycle be seen at all: each file knows one hop, so no
      // amount of validating a single workflow would ever find it.
      problems.push({
        severity: 'error',
        message: `${[...visiting.slice(ring), name].join(' needs ')} — a workflow cannot need itself, however far around`,
        field: 'needs',
        rule: 'needs.cycle',
      })
      return
    }

    const needs = needsOf(name)
    if (needs === undefined) {
      // Reported, not fatal. A typo in something unrelated must not stop the
      // rest of the list being assembled.
      problems.push({
        severity: 'error',
        message: `"${name}" does not resolve to a workflow in any scope`,
        field: 'needs',
        rule: 'needs.missing',
      })
      placed.add(name)
      order.push(name)
      if (!isWanted) added.push(name)
      return
    }

    visiting.push(name)
    for (const predecessor of needs) place(predecessor, false)
    visiting.pop()

    // A predecessor's own chain may have placed this one on the way past.
    if (placed.has(name) && !isWanted) return
    placed.add(name)
    order.push(name)
    if (!isWanted) added.push(name)
  }

  for (const name of wanted) place(name, true)
  return { order, added, problems }
}

/**
 * Names in `wanted` that appear before something they need.
 *
 * Assembling the list correctly is the builder's job; this is for saying so
 * about a list that was assembled some other way — by the API, by hand, or
 * before the predecessor existed. It reports rather than repairs, because a
 * task's list is the plan somebody wrote.
 */
export function needsOutOfOrder(
  wanted: readonly string[],
  needsOf: (name: string) => readonly string[] | undefined,
): { readonly workflow: string; readonly missing: string; readonly late: boolean }[] {
  const found: { workflow: string; missing: string; late: boolean }[] = []
  wanted.forEach((name, at) => {
    for (const predecessor of needsOf(name) ?? []) {
      const where = wanted.indexOf(predecessor)
      if (where === -1) found.push({ workflow: name, missing: predecessor, late: false })
      else if (where > at) found.push({ workflow: name, missing: predecessor, late: true })
    }
  })
  return found
}
