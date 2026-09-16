import type { Problem } from '../problems.js'
import type { TaskState } from './state.js'

/**
 * One task waiting for another.
 *
 * `todolist`'s own `PROJECT.md` lists ten tasks with a dependency column, and it
 * is a graph rather than a chain — "tasks 3 and 4 can run at the same time; so
 * can 7 and 8". Factory had nowhere to put that, so the order lived in
 * somebody's head and was enforced by queueing one task and watching.
 *
 * Deliberately **not** `resolveNeeds`, whose walk this borrows. That function
 * relates *workflow definitions within one task's list*: its signature is
 * workflow names, its problems are `needs.missing` and `needs.cycle`, and its
 * wording is "a workflow cannot need itself". A ring among tasks has to name
 * tasks. Two topological walks in one repository is a real cost and it is taken
 * with open eyes — if a third appears, extract one.
 *
 * Also deliberately not flags. `engine/src/doctor.ts` carries a comment left
 * specifically to stop this: flags are keyed `(task_id, flag)` and written only
 * by the engine onto the task whose own run just finished, so no task can ever
 * set a flag another task reads.
 *
 * Pure, and takes its lookups as arguments, so the scheduler and the API can
 * share one answer without either owning a store.
 */

/** An edge: `taskId` cannot start until `dependsOn` is done. */
export interface TaskEdge {
  readonly taskId: string
  readonly dependsOn: string
}

/**
 * What a dependent needs to know about a blocker.
 *
 * `completedAt` and not just the state, because of archiving: `archived` is
 * reachable from `done` *and* from `draft`, so the state alone cannot tell
 * "finished, then put away" from "put away without ever running". Tidying a
 * finished task must not silently stall everything behind it.
 */
export interface BlockerFacts {
  readonly state: TaskState
  /** Set when it reached `done` at some point, even if it was archived since. */
  readonly completedAt?: string
}

/**
 * Whether a blocker is satisfied, might yet be, or never will be.
 *
 * `dead` is the one that earns its place: a blocker that was cancelled or
 * failed can never become done, so leaving the dependent in the queue would
 * park it for ever looking like it was about to run — which is the state the
 * board exists to make obvious.
 */
export type DependencyState = 'met' | 'waiting' | 'dead'

export interface DependencyStatus {
  readonly state: DependencyState
  /** Blockers not done yet, that still could be. */
  readonly waitingFor: readonly string[]
  /** Blockers that can never be done, and why each one cannot. */
  readonly dead: readonly { readonly id: string; readonly because: string }[]
}

/** The tasks one task is waiting for, in the order the edges were given. */
export function blockersOf(taskId: string, edges: readonly TaskEdge[]): readonly string[] {
  const seen = new Set<string>()
  const blockers: string[] = []
  for (const edge of edges) {
    if (edge.taskId !== taskId || seen.has(edge.dependsOn)) continue
    seen.add(edge.dependsOn)
    blockers.push(edge.dependsOn)
  }
  return blockers
}

/**
 * Whether this task's dependencies let it start.
 *
 * `dead` beats `waiting`: one blocker that can never finish settles the
 * question however many others are merely in progress.
 */
export function dependencyStatus(
  taskId: string,
  edges: readonly TaskEdge[],
  factsOf: (id: string) => BlockerFacts | undefined,
): DependencyStatus {
  const waitingFor: string[] = []
  const dead: { id: string; because: string }[] = []

  for (const id of blockersOf(taskId, edges)) {
    const facts = factsOf(id)

    if (facts === undefined) {
      // Deleting a task cascades its edges away, so this needs a hand-edited
      // database to reach. Dead rather than ignored: a blocker nobody can find
      // is a blocker that will never be done, and silently starting is worse.
      dead.push({ id, because: 'it no longer exists' })
      continue
    }
    if (facts.state === 'done') continue
    if (facts.state === 'archived') {
      if (facts.completedAt !== undefined) continue
      dead.push({ id, because: 'it was archived without finishing' })
      continue
    }
    if (facts.state === 'cancelled') {
      dead.push({ id, because: 'it was cancelled' })
      continue
    }
    if (facts.state === 'blocked') {
      dead.push({ id, because: 'it is blocked' })
      continue
    }
    waitingFor.push(id)
  }

  if (dead.length > 0) return { state: 'dead', waitingFor, dead }
  if (waitingFor.length > 0) return { state: 'waiting', waitingFor, dead }
  return { state: 'met', waitingFor, dead }
}

export interface QueueOrder {
  /** The ids given, blockers before dependents. */
  readonly order: readonly string[]
  readonly problems: readonly Problem[]
}

/**
 * The order to queue a set of tasks in.
 *
 * Only edges *within the set* order it. A blocker outside the set is not an
 * ordering constraint among these — it is usually one that is already done and
 * so not being queued at all — and treating it as one would mean refusing to
 * order a batch because of a task that finished last week.
 *
 * Ties keep the order they were given, which is what preserves the parallel
 * pairs a project asks for: `todolist`'s 3 and 4 both depend on 2 and neither
 * on the other, so they come out in the order the caller listed them rather
 * than in whatever order a set happened to iterate.
 */
export function queueOrder(taskIds: readonly string[], edges: readonly TaskEdge[]): QueueOrder {
  const wanted = new Set(taskIds)
  const problems: Problem[] = []
  const order: string[] = []
  const placed = new Set<string>()
  /** The current descent, so a ring is caught rather than followed. */
  const visiting: string[] = []

  const place = (id: string): void => {
    if (placed.has(id)) return

    const ring = visiting.indexOf(id)
    if (ring !== -1) {
      // Only a walk can see a ring: each edge knows one hop, so no amount of
      // checking a single task would ever find it.
      problems.push({
        severity: 'error',
        message:
          `${[...visiting.slice(ring), id].join(' depends on ')} — ` +
          `a task cannot depend on itself, however far around`,
        field: 'dependsOn',
        rule: 'dependencies.cycle',
      })
      return
    }

    visiting.push(id)
    for (const blocker of blockersOf(id, edges)) {
      if (wanted.has(blocker)) place(blocker)
    }
    visiting.pop()

    placed.add(id)
    order.push(id)
  }

  for (const id of taskIds) place(id)
  return { order, problems }
}
