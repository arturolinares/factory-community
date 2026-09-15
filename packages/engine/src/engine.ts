import {
  isRunFinished,
  runPlan,
  type Problem,
  type ResolvedPlan,
  type PlanResult,
  type Run,
  type RunOptions,
  type RunResult,
  type StepState,
  type Task,
  type TaskWorkflowEntry,
  IGNORED_BY_PRODUCT,
  PRODUCT_FAMILY_DIR,
  fileStamp,
} from '@factory/core'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import type { EventBus } from '@factory/events'
import type { RunRepository, TaskRepository } from '@factory/store'

/**
 * The engine: a task, its workflows, and what actually happened.
 *
 * Increment 1's runner takes a plan and runs it in one process, reporting
 * through callbacks. That is still the thing that runs steps — this does not
 * reimplement it. What the engine adds is everything around a run that has to
 * outlive the process: which workflow of the task we are on, a row per step, the
 * output filed against it, and the task's state kept in step with all of it.
 *
 * Two rules shape it.
 *
 * The task's state only ever changes through `TaskRepository.act`, so the rules
 * in core apply to the engine exactly as they apply to a person clicking a
 * button. The prototype's scheduler wrote states directly and that is how a
 * blocked task ended up started.
 *
 * And an approval gate parks rather than asks. The engine may be running with
 * nobody watching, so a gate stops the run, remembers the phase to continue
 * from, and puts the task in `awaiting_approval` where a person can find it.
 * `runPlan` reports that as "declined" because its own caller answered no; here
 * that answer always means "not yet".
 */

export interface EngineOptions {
  readonly tasks: TaskRepository
  readonly runs: RunRepository
  /**
   * Turns a workflow name into a plan for this task.
   *
   * Injected rather than imported so the engine depends on neither the scope
   * chain nor the filesystem: the daemon passes `planWorkflow` bound to its
   * runtime, and a test passes a plan it built in memory.
   *
   * `failure` is set only when planning a recovery workflow, so the caller can
   * put the phase and reason in front of the agent that has to diagnose it.
   */
  readonly plan: (input: {
    workflow: string
    task: Task
    failure?: FailureContext
    /**
     * The agent session this run's steps should share.
     *
     * Decided here rather than by the planner, because only the engine can see
     * both the task's recorded session and the run about to happen. `started`
     * false means the first agent step will create it.
     */
    session?: { id: string; started: boolean }
  }) => PlanResult
  /** Executes a plan. Defaults to the real runner. */
  readonly execute?: (options: RunOptions) => Promise<RunResult>
  readonly events?: EventBus
  /** Seconds a single step may take. Passed through to the runner. */
  readonly timeoutSeconds?: number
  /** Injected so a loop's next-iteration time is testable. */
  readonly now?: () => Date
  /**
   * Mints the id for a task's agent session. Injected so it is testable.
   *
   * Factory chooses the id rather than reading one back, which is what makes a
   * session resumable exactly — by the next phase, by a re-run, and by a
   * person opening a terminal — instead of by "the most recent conversation in
   * this directory", which is the wrong one the moment two tasks share it.
   */
  readonly newSessionId?: () => string
}

/** How long a loop waits between iterations when the workflow does not say. */
export const DEFAULT_LOOP_INTERVAL_SECONDS = 60

export interface EngineOutcome {
  readonly task: Task
  /** The runs this call produced or continued, in order. */
  readonly runs: readonly Run[]
  readonly problems: readonly Problem[]
}

/** What went wrong, for the workflow asked to look into it. */
export interface FailureContext {
  /** The workflow that failed. */
  readonly workflow: string
  /** The phase its last step was in. */
  readonly phase?: string
  readonly reason: string
}

/** Why the engine stopped working on a task. */
type Stop = 'finished' | 'blocked' | 'paused' | 'idle'

export class Engine {
  readonly #tasks: TaskRepository
  readonly #runs: RunRepository
  readonly #plan: EngineOptions['plan']
  readonly #execute: (options: RunOptions) => Promise<RunResult>
  readonly #events: EventBus | undefined
  readonly #timeoutSeconds: number | undefined
  readonly #now: () => Date
  readonly #newSessionId: () => string

  constructor(options: EngineOptions) {
    this.#tasks = options.tasks
    this.#runs = options.runs
    this.#plan = options.plan
    this.#execute = options.execute ?? runPlan
    this.#events = options.events
    this.#timeoutSeconds = options.timeoutSeconds
    this.#now = options.now ?? (() => new Date())
    this.#newSessionId = options.newSessionId ?? (() => randomUUID())
  }

  /**
   * Work a task through its workflows until it finishes, fails or reaches a gate.
   *
   * Called with a queued task to start it, and with a running one to continue
   * after an approval. Anything else is refused loudly: a task in the wrong
   * state means something else already owns it, and two owners is worse than
   * one error.
   */
  async run(taskId: string): Promise<EngineOutcome> {
    let task = this.#require(taskId)
    const produced: Run[] = []
    const problems: Problem[] = []

    const paused = this.#runs.pausedFor(taskId)

    if (task.state === 'queued') {
      task = this.#tasks.act(taskId, 'start')
    } else if (task.state === 'running') {
      // Already ours: either the scheduler admitted it — it marks a task
      // running before handing it over, so two ticks cannot admit the same task
      // twice — or a person approved it and it is holding a paused run.
    } else {
      throw new Error(
        `Cannot run "${task.name}": it is ${task.state}. ` +
          `The engine starts a queued task, or continues one that is already running.`,
      )
    }

    if (task.workflows.length === 0) {
      // Nothing to do is not a failure, but it is not success either — silently
      // completing would tell the board the work is done.
      this.#tasks.act(taskId, 'block', { reason: 'No workflows are assigned.' })
      return { task: this.#require(taskId), runs: produced, problems }
    }

    if (!task.workflows.some((entry) => entry.enabled)) {
      // Ticked nothing is the same shape of nothing-to-do as assigned nothing.
      // Reachable: untick the blocked entry of a blocked task, then retry.
      this.#tasks.act(taskId, 'block', { reason: 'No workflows are ticked to run.' })
      return { task: this.#require(taskId), runs: produced, problems }
    }

    // Which entry is next is the first one still ticked — with one deliberate
    // tie-break: a paused run holds phases that have already executed, so it
    // resumes at its own entry even when something earlier is ticked.
    let resuming = paused
    let forced = paused === undefined
      ? undefined
      : task.workflows.find((entry) => entry.id === paused.entryId)
    /** Entries this call has finished, so a mismatch cannot spin for ever. */
    const settled = new Set<string>()

    for (;;) {
      const entry = forced ?? task.workflows.find((candidate) => candidate.enabled)
      if (entry === undefined) break
      if (settled.has(entry.id)) {
        // `finished` matched nothing — a wrong id, or a concurrent edit. The
        // old loop counted an index up and could not spin; this one can, and
        // spinning here means launching an agent every time round.
        throw new Error(
          `"${entry.workflow}" finished but is still ticked. Refusing to run it again.`,
        )
      }
      const result = await this.#runOne({ task, entry, resuming })
      resuming = undefined
      forced = undefined
      produced.push(result.run)
      problems.push(...result.problems)
      if (result.stop !== 'finished') {
        return { task: this.#require(taskId), runs: produced, problems }
      }
      // Where `advance` was, under the same condition. A loop mid-repeat stops
      // at `idle` rather than `finished`, so it never reaches here and keeps
      // its tick — no special case needed.
      this.#tasks.finished(taskId, entry.id)
      settled.add(entry.id)
      // Re-read: the entries have changed, and a workflow that just earned a
      // flag should be visible to the next one's plan.
      task = this.#require(taskId)
    }

    this.#tasks.act(taskId, 'complete')
    return { task: this.#require(taskId), runs: produced, problems }
  }

  async #runOne(input: {
    task: Task
    /** The entry being run. A recovery reuses the entry of the one that failed. */
    entry: TaskWorkflowEntry
    /** Overrides the entry's own name, for a recovery workflow. */
    workflow?: string
    resuming: Run | undefined
    /**
     * A recovery run, started because another workflow failed. It never moves
     * the task itself — the workflow that failed does that once, when the
     * recovery is over — and its own `on_fail` is ignored, so a recovery that
     * fails cannot start another one.
     */
    recovery?: FailureContext
  }): Promise<{ run: Run; stop: Stop; problems: readonly Problem[] }> {
    const { task, entry } = input
    const workflow = input.workflow ?? entry.workflow
    // The position, for `runs.workflow_index`. The entry's id is the handle
    // everything else uses; the index is kept because old rows have one and
    // the wire still carries it.
    const index = task.workflows.findIndex((candidate) => candidate.id === entry.id)
    const isRecovery = input.recovery !== undefined
    const move = (
      action: 'block' | 'await_approval' | 'complete' | 'idle',
      options: { reason?: string; until?: string } = {},
    ): void => {
      if (!isRecovery) this.#tasks.act(task.id, action, options)
    }
    // One session per task, minted the first time and reused for ever after.
    //
    // Read from the store rather than from the task this call was handed. A
    // recovery run is started with the task as it was *before* its workflow
    // ran, and that workflow may have recorded the session on its way to
    // failing — so trusting the argument would mint a second id and hand the
    // agent asked to diagnose the failure a blank conversation.
    const recorded = this.#tasks.get(task.id)?.session
    const session = {
      id: recorded?.id ?? this.#newSessionId(),
      started: recorded !== undefined,
    }
    const planned = this.#plan({
      workflow,
      task,
      session,
      ...(input.recovery === undefined ? {} : { failure: input.recovery }),
    })

    if (planned.plan === undefined) {
      // A plan that will not resolve is recorded as a run that never started,
      // rather than left as an error in a log nobody keeps: "why did nothing
      // happen?" is the question the prototype could never answer.
      const run = this.#runs.start({
        workflow,
        taskId: task.id,
        workflowIndex: index,
        entryId: entry.id,
        attempt: this.#runs.attempts(task.id, workflow) + 1,
      })
      const detail = summarise(planned.problems, `"${workflow}" could not be planned.`)
      this.#runs.finish(run.id, 'refused', { detail })
      move('block', { reason: detail })
      return { run: this.#runs.get(run.id) as Run, stop: 'blocked', problems: planned.problems }
    }

    const plan = planned.plan
    const run =
      input.resuming !== undefined
        ? this.#runs.resume(input.resuming.id)
        : this.#runs.start({
            workflow,
            taskId: task.id,
            workflowIndex: index,
            entryId: entry.id,
            attempt: this.#runs.attempts(task.id, workflow) + 1,
          })

    // Keyed by where the step is in the plan rather than by "the step running
    // now": output arrives asynchronously, and a single mutable cursor is wrong
    // the moment anything overlaps.
    const stepIds = new Map<string, number>()
    const key = (phase: string, stepIndex: number) => `${phase}#${stepIndex}`

    // The agent is told to write to a path, so the path has to exist before it
    // is told. Done here rather than at plan time: `resolvePlan` is pure, and
    // that is what makes `doctor` and `--dry-run` safe to run.
    this.#prepareArtifacts(plan)

    const result = await this.#execute({
      plan,
      ...(this.#timeoutSeconds === undefined ? {} : { timeoutSeconds: this.#timeoutSeconds }),
      ...(this.#events === undefined ? {} : { events: this.#events }),
      runId: run.id,
      ...(input.resuming?.resumePhase === undefined
        ? {}
        : { startPhase: input.resuming.resumePhase, approved: true }),
      onStep: (step, phase) => {
        const stored = this.#runs.startStep(run.id, {
          phase: phase.name,
          index: step.index,
          describe: step.planned.describe,
          uses: step.uses,
        })
        stepIds.set(key(phase.name, step.index), stored.id)
      },
      onOutput: (chunk, stream, step, phase) => {
        const stepId = stepIds.get(key(phase.name, step.index))
        this.#runs.append({
          runId: run.id,
          ...(stepId === undefined ? {} : { stepId }),
          stream,
          text: chunk,
        })
      },
      onStepDone: (outcome, step, phase) => {
        // Written down only once the process actually started. `error` is set
        // exactly when it could not be — no CLI on PATH, a directory that has
        // gone — and in that case no session was created, so recording the id
        // would leave every later run asking to resume a conversation that was
        // never had. Nothing recorded means the next run starts one.
        if (step.planned.session?.creates === true && outcome.error === undefined) {
          this.#tasks.rememberSession(task.id, {
            id: step.planned.session.id,
            provider: step.planned.session.provider,
          })
        }
        const stepId = stepIds.get(key(phase.name, step.index))
        if (stepId === undefined) return
        this.#runs.finishStep(stepId, {
          state: stepStateOf(outcome.exitCode, outcome.timedOut),
          attempts: outcome.attempts,
          ...(outcome.exitCode === null ? {} : { exitCode: outcome.exitCode }),
          ...(outcome.error === undefined ? {} : { detail: outcome.error }),
        })
      },
      // Always "not yet". The engine has no person to ask, so a gate parks the
      // run instead of guessing an answer.
      onApproval: () => Promise.resolve(false),
    })

    // Collected before the verdict is recorded, so evidence is already there
    // when the task lands in front of a person — which for an approval gate is
    // the entire point of having it.
    const evidenceProblems = this.#collectEvidence(run.id, plan, result)
    const problems = [...result.problems, ...evidenceProblems]
    const detail = summarise(result.problems, '')

    switch (result.status) {
      case 'completed': {
        this.#runs.finish(run.id, 'completed')
        // Only a completed workflow earns its flags. A run that failed halfway
        // may well have created the worktree it promised, but nothing here knows
        // that, and claiming a flag that is not true is worse than re-running.
        if (plan.provides.length > 0 || plan.clears.length > 0) {
          this.#tasks.changeFlags(task.id, { set: plan.provides, clear: plan.clears })
        }

        // A loop repeats the workflow it is on rather than moving to the next
        // one, so the task goes back to the queue with its place kept and a
        // time before which the scheduler leaves it alone.
        //
        // Unless it has done its repeats. The count is *derived* — completed
        // runs of this workflow position — rather than kept in a column: a
        // counter would be a second copy of something the runs already say, and
        // the two would disagree the first time a run was deleted or replayed.
        if (plan.mode === 'loop' && !isRecovery && !this.#loopIsDone(task, plan, run)) {
          const seconds = plan.interval ?? DEFAULT_LOOP_INTERVAL_SECONDS
          move('idle', {
            until: new Date(this.#now().getTime() + seconds * 1000).toISOString(),
          })
          return { run: this.#runs.get(run.id) as Run, stop: 'idle', problems }
        }

        return { run: this.#runs.get(run.id) as Run, stop: 'finished', problems }
      }

      case 'declined': {
        // Everything before the gate has run; continue after it when approved.
        const resumeFrom = plan.phases.length - result.skipped.length
        this.#runs.pause(run.id, resumeFrom, detail === '' ? undefined : detail)
        move('await_approval')
        return { run: this.#runs.get(run.id) as Run, stop: 'paused', problems }
      }

      default: {
        const state = result.status === 'timed-out' ? 'timed-out' : 'failed'
        const reason = detail === '' ? `"${workflow}" ${state}.` : detail
        this.#recordSkipped(run.id, plan, result)
        this.#runs.finish(run.id, result.status === 'refused' ? 'refused' : state, {
          detail: reason,
        })

        // Recovery runs before the task is blocked, so whoever opens the task
        // finds the diagnosis already written rather than a failure and a
        // suggestion to go and look.
        if (!isRecovery && plan.onFail !== undefined) {
          const failure: FailureContext = {
            workflow,
            ...(result.steps.at(-1)?.phase === undefined
              ? {}
              : { phase: result.steps.at(-1)?.phase as string }),
            reason,
          }
          await this.#runOne({
            task,
            entry,
            workflow: plan.onFail,
            resuming: undefined,
            recovery: failure,
          })
        }

        move('block', { reason })
        return { run: this.#runs.get(run.id) as Run, stop: 'blocked', problems }
      }
    }
  }

  /**
   * Make the directories the agents were told to write into.
   *
   * Including `versions/`, so the copy taken afterwards has somewhere to land
   * without a second mkdir at the moment it matters. Failing here is reported
   * by the missing-artifact warning later rather than stopping the run: a
   * read-only checkout should not make a workflow un-runnable.
   */
  #prepareArtifacts(plan: ResolvedPlan): void {
    for (const step of plan.phases.flatMap((phase) => phase.steps)) {
      if (step.artifact === undefined) continue
      try {
        mkdirSync(join(dirname(step.artifact.path), 'versions'), { recursive: true })
        this.#ignoreProductOutput(step.artifact.path)
      } catch {
        // Said later, by the warning that names the file that is not there.
      }
    }
  }

  /**
   * Keep a run's output out of `git status`.
   *
   * Definitions under `.xaedalon/.factory` are meant to be committed; what a run
   * produced is not, and a repository that grows a diff every time an agent
   * thinks is a repository nobody wants. Written once, next to the directory it
   * is about, and never touched again if it is already there — it is the user's
   * file the moment it exists.
   */
  #ignoreProductOutput(artifactPath: string): void {
    const family = artifactPath.indexOf(`${sep}${PRODUCT_FAMILY_DIR}${sep}`)
    if (family === -1) return
    const file = join(artifactPath.slice(0, family), PRODUCT_FAMILY_DIR, '.gitignore')
    if (existsSync(file)) return
    writeFileSync(file, `${IGNORED_BY_PRODUCT}\n`)
  }

  /**
   * Copy what each step promised into the run, and keep a dated copy of it.
   *
   * Two copies, for two different reasons. `versions/` is the history — every
   * run's output, so a rerun can be compared with what it replaced — and the
   * row in the database is what the board reads, kept because the file is
   * gitignored and deletable while the record of a decision should not be.
   *
   * A step that declared an artifact and produced nothing gets a row saying so
   * and a warning. Not a failure — plenty of artifacts are legitimately
   * optional — but never silence, which is what the prototype had.
   */
  /**
   * Whether a bounded loop has run as many times as it was asked to.
   *
   * Counts completed runs at this workflow position, which includes the one
   * that has just finished — so `repeat: 1` runs once, not twice. A loop with
   * no `repeat` is never done: it goes round until a person stops it, which is
   * what a loop meant before this existed.
   */
  #loopIsDone(task: Task, plan: ResolvedPlan, run: Run): boolean {
    if (plan.repeat === undefined) return false
    const done = this.#runs
      .forTask(task.id)
      .filter(
        (candidate) =>
          candidate.entryId === run.entryId &&
          // A recovery run is stamped with the entry of the workflow that
          // failed, so without this its completion counts as an iteration of
          // a loop it was never part of.
          candidate.workflow === run.workflow &&
          candidate.state === 'completed',
      ).length
    return done >= plan.repeat
  }

  #collectEvidence(runId: string, plan: ResolvedPlan, result: RunResult): Problem[] {
    // What actually ran. `result.skipped` is phase-granular, and a step can be
    // the one a phase stopped at, so the outcomes are the honest source.
    const ran = new Set(result.steps.map((outcome) => `${outcome.phase}#${outcome.index}`))
    const stamp = fileStamp(this.#now())
    const problems: Problem[] = []

    for (const phase of plan.phases) {
      for (const step of phase.steps) {
        const artifact = step.artifact
        if (artifact === undefined) continue
        if (!ran.has(`${phase.name}#${step.index}`)) continue

        try {
          const size = statSync(artifact.path).size
          const raw = readFileSync(artifact.path)
          // A NUL byte means this is not text. The row still records that the
          // file exists and how big it is; storing mojibake would help nobody.
          const binary = raw.includes(0)

          // The dated copy first: if writing it fails, the evidence row should
          // still be recorded rather than the whole artifact going unnoticed.
          try {
            writeFileSync(
              join(dirname(artifact.path), 'versions', `${artifact.name}-${stamp}.md`),
              raw,
            )
          } catch {
            // The history is a convenience; the evidence is the record.
          }

          this.#runs.attachEvidence({
            runId,
            phase: phase.name,
            name: artifact.name,
            path: artifact.path,
            bytes: size,
            ...(binary ? {} : { content: raw.toString('utf8') }),
          })
        } catch {
          this.#runs.attachEvidence({
            runId,
            phase: phase.name,
            name: artifact.name,
            path: artifact.path,
            missing: true,
          })
          problems.push({
            severity: 'warning',
            message:
              `A step in "${phase.name}" promised the artifact "${artifact.name}", but there is ` +
              `nothing at ${artifact.path}.`,
            rule: 'run.artifactMissing',
          })
        }
      }
    }
    return problems
  }

  /** Phases the run never reached, so the timeline shows what did not happen. */
  #recordSkipped(runId: string, plan: ResolvedPlan, result: RunResult): void {
    const skipped = new Set(result.skipped)
    for (const phase of plan.phases) {
      if (!skipped.has(phase.name)) continue
      for (const step of phase.steps) {
        this.#runs.skipStep(
          runId,
          {
            phase: phase.name,
            index: step.index,
            describe: step.planned.describe,
            uses: step.uses,
          },
          'An earlier step stopped the run.',
        )
      }
    }
  }

  #require(id: string): Task {
    const task = this.#tasks.get(id)
    if (task === undefined) throw new Error(`No task ${id}.`)
    return task
  }
}

const stepStateOf = (exitCode: number | null, timedOut: boolean): StepState => {
  if (timedOut) return 'timed-out'
  return exitCode === 0 ? 'completed' : 'failed'
}

/** The first error, or the first problem of any kind, in a sentence. */
function summarise(problems: readonly Problem[], fallback: string): string {
  const error = problems.find((problem) => problem.severity === 'error') ?? problems[0]
  return error?.message ?? fallback
}

export { isRunFinished }
