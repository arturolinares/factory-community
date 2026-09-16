/**
 * What Factory started, so that Factory can stop it.
 *
 * Cancelling a run used to flip a database row and nothing else. The agent ran
 * to completion; the engine's next transition threw `TransitionError` because
 * `complete` has no edge from `cancelled`; the scheduler swallowed that error
 * because the task was no longer `running`; and the run row stayed `running`
 * until the next daemon boot corrected it as "Factory stopped while this was
 * running." The button said cancelled and nothing was.
 *
 * There were three separate reasons it could not work, and all three had to go:
 *
 * 1. **Nothing held the child.** `runStep` kept the handle inside a promise
 *    closure, so once the step was running nothing outside could reach it.
 * 2. **The child led no process group.** `spawn` was called without
 *    `detached`, so `child.kill()` signalled one pid — and a step is almost
 *    always `bash -c '…'`, whose actual work is a grandchild that survived.
 * 3. **Shutdown did not try.** `bin.ts` hard-exits after three seconds while a
 *    step may have half an hour left, leaving whatever was running orphaned.
 *
 * This module is the first: one place that knows which processes belong to
 * which run. The registry takes an interface rather than a `ChildProcess`, so
 * the rules are exercisable without spawning anything — and one scenario does
 * spawn something, because the claim being made is about grandchildren and no
 * fake can be wrong about those in the same way.
 */

/** The two signals worth sending, in the order they are worth sending them. */
export type StopSignal = 'SIGTERM' | 'SIGKILL'

/**
 * Something Factory started and can signal.
 *
 * `kill` answers whether a signal was actually delivered, so a caller can tell
 * "stopped it" from "it was already gone" — which is the difference between a
 * kill switch that worked and one with nothing to do.
 */
export interface StoppableProcess {
  readonly pid: number
  kill(signal: StopSignal): boolean
}

/**
 * Signal a child's whole process group.
 *
 * A negative pid means "the group" to `process.kill`, and a child spawned with
 * `detached: true` leads a group of its own. This is the difference between
 * killing `bash` and killing the `npm test` it started.
 *
 * Falls back to signalling the single process when the group call fails, which
 * happens for a child that was not detached and on a platform without process
 * groups. A narrower guarantee, and better than none.
 */
export function processGroup(child: {
  readonly pid?: number | undefined
  kill(signal: NodeJS.Signals): boolean
}): StoppableProcess | undefined {
  const pid = child.pid
  // No pid means the spawn failed. There is nothing to register and nothing to
  // stop, and registering it would leave an entry that can never be cleared.
  if (pid === undefined) return undefined

  return {
    pid,
    kill: (signal) => {
      try {
        process.kill(-pid, signal)
        return true
      } catch {
        try {
          return child.kill(signal)
        } catch {
          // Already gone. Not a failure: the outcome asked for is the outcome.
          return false
        }
      }
    },
  }
}

/** How long a process gets to exit politely before it is killed. */
export const STOP_GRACE_MS = 3_000

export interface StopReport {
  /** Process groups sent SIGTERM. */
  readonly signalled: number
  /** Of those, the ones still alive after the grace period and so killed. */
  readonly killed: number
}

/**
 * Which processes belong to which run.
 *
 * Keyed by run id because that is what a person cancels, and because a run's
 * steps are sequential — so in practice each entry holds one process, and the
 * set is there for the case where that stops being true rather than as
 * speculation.
 */
export class ProcessRegistry {
  readonly #byRun = new Map<string, Set<StoppableProcess>>()
  readonly #wait: (ms: number) => Promise<void>

  constructor(options: { readonly wait?: (ms: number) => Promise<void> } = {}) {
    // Injected so the grace period is testable without waiting for it, the way
    // `RunOptions.wait` already is for retry delays.
    this.#wait =
      options.wait ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }))
  }

  /**
   * Remember a process, and hand back the way to forget it.
   *
   * A remover rather than a `remove(runId, process)` method, because the caller
   * that has to forget is the one that registered and it should not have to
   * keep both keys to do it. Forgetting is not optional: an entry left behind
   * is a pid this class would later signal, and pids are reused.
   */
  add(runId: string, target: StoppableProcess): () => void {
    const existing = this.#byRun.get(runId) ?? new Set<StoppableProcess>()
    existing.add(target)
    this.#byRun.set(runId, existing)

    return () => {
      const current = this.#byRun.get(runId)
      if (current === undefined) return
      current.delete(target)
      if (current.size === 0) this.#byRun.delete(runId)
    }
  }

  /** Run ids with at least one live process. */
  runs(): readonly string[] {
    return [...this.#byRun.keys()]
  }

  /** How many processes are held, for one run or in total. */
  count(runId?: string): number {
    if (runId !== undefined) return this.#byRun.get(runId)?.size ?? 0
    let total = 0
    for (const group of this.#byRun.values()) total += group.size
    return total
  }

  /**
   * Stop one run's processes: SIGTERM, a grace period, then SIGKILL.
   *
   * Polite first, because a coding agent interrupted mid-write can leave a
   * half-written file, and the three seconds cost nothing when it goes. Then
   * SIGKILL, because a kill switch that can be ignored is not one.
   *
   * Entries are not removed here. Whoever registered them removes them when the
   * process actually ends, which is the only moment that is true — and a
   * SIGKILLed process still fires `close`.
   */
  async stop(runId: string): Promise<StopReport> {
    const targets = [...(this.#byRun.get(runId) ?? [])]
    return this.#stop(targets)
  }

  /** Stop everything. The kill switch. */
  async stopAll(): Promise<StopReport> {
    const targets = [...this.#byRun.values()].flatMap((group) => [...group])
    return this.#stop(targets)
  }

  async #stop(targets: readonly StoppableProcess[]): Promise<StopReport> {
    const signalled = targets.filter((target) => target.kill('SIGTERM'))
    if (signalled.length === 0) return { signalled: 0, killed: 0 }

    await this.#wait(STOP_GRACE_MS)

    // Whatever is still there after the grace period. `kill` returning true a
    // second time is how we know it had not gone.
    const killed = signalled.filter((target) => target.kill('SIGKILL'))
    return { signalled: signalled.length, killed: killed.length }
  }
}
