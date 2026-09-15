import type { Run, Task } from '@factory/core'
import type { RunRepository, TaskRepository } from '@factory/store'

/**
 * Putting the store back in touch with reality at boot.
 *
 * A run row says "running" because a process was running when it was written.
 * If that process is gone — the machine restarted, the daemon was killed, a
 * laptop lid closed — the row is now a lie, and everything downstream believes
 * it: the board shows a spinner forever, the scheduler counts a slot that is
 * not in use, and the task can never be retried because it looks busy.
 *
 * The prototype had exactly this. Its answer was for a person to notice and
 * edit the database. This runs at boot, before anything else is allowed to
 * start, and says plainly what it closed.
 */

export interface ReconcileReport {
  /** Runs that were marked running and could not have been. */
  readonly closedRuns: readonly Run[]
  /** Tasks left mid-flight, now blocked so a person can decide. */
  readonly blockedTasks: readonly Task[]
}

export function reconcile(options: {
  tasks: TaskRepository
  runs: RunRepository
  /** What to record as the reason. The daemon says which start-up noticed. */
  reason?: string
}): ReconcileReport {
  const reason = options.reason ?? 'Factory stopped while this was running.'
  const closedRuns: Run[] = []
  const blockedTasks: Task[] = []

  // Paused runs are deliberately left alone: one is waiting for a person, not
  // for a process, and closing it would throw away work that did happen.
  for (const run of options.runs.running()) {
    closedRuns.push(options.runs.finish(run.id, 'failed', { detail: reason }))
  }

  // Blocked rather than re-queued. Restarting work that was halfway through can
  // repeat side effects — a pushed branch, a posted comment, a deployed build —
  // so the decision to run it again belongs to a person.
  for (const task of options.tasks.list({ state: 'running' })) {
    // Unless it is waiting to be resumed: a task someone approved just before
    // the stop has a paused run holding everything that already happened, and
    // the scheduler picks it up. Blocking it would throw the approval away.
    if (options.runs.pausedFor(task.id) !== undefined) continue
    blockedTasks.push(options.tasks.act(task.id, 'block', { reason }))
  }

  return { closedRuns, blockedTasks }
}
