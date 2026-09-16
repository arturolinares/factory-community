import {
  Engine,
  Scheduler,
  reconcile,
  runningInstallationPlugin,
  type FailureContext,
  type ProjectFacts,
  type ReconcileReport,
  type WorkflowFacts,
} from '@factory/engine'
import { definitionPath, planWorkflow, resolveWorkflow } from '@factory/config'
import { artifactsRoot, systemCanonical, taskTokenValues, workspaceFor } from '@factory/core'
import type { FAILURE_TOKENS, PROJECT_TOKENS } from '@factory/core'
import { createChains, type Chains } from './chains.js'
import {
  MIGRATIONS,
  ProjectRepository,
  RunRepository,
  TaskRepository,
  openStore,
  storePath,
  type Store,
} from '@factory/store'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, Task, TaskWorkspace } from '@factory/core'
import type { Runtime } from '@factory/runtime'

/**
 * The running half of a Factory installation.
 *
 * The runtime assembles what is *installed* — scopes, host, plugins — and the
 * CLI is happy with that alone. This adds what is *happening*: the database,
 * the repositories, the engine and the scheduler. It lives in the daemon
 * because only a long-lived process should hold them; a CLI invocation that
 * opened the database to print a list would be competing with the process that
 * is writing to it.
 */
export interface Service {
  readonly store: Store
  readonly tasks: TaskRepository
  readonly runs: RunRepository
  readonly projects: ProjectRepository
  /** Which definitions each project can see. Served by the definition routes. */
  readonly chains: Chains
  /**
   * Where this task's steps run — its worktree, or its project's checkout.
   *
   * Undefined for a task with no project. The rule is core's; what the Service
   * adds is the repository, the filesystem and the path join, so a route can
   * ask the question without assembling it again.
   */
  readonly workspace: (task: Task) => TaskWorkspace | undefined
  readonly engine: Engine
  readonly scheduler: Scheduler
  /** What the boot found left over from last time. Reported by `/api/health`. */
  readonly reconciliation: ReconcileReport
  close(): Promise<void>
}

export type { TaskWorkspace }

export interface ServiceOptions {
  /** Database file. Defaults to the writable scope's `state/factory.db`. */
  readonly file?: string
  readonly maxParallel?: number
  /**
   * Whether the scheduler reacts to events on its own. Off in tests that are
   * about the API rather than about work actually running.
   */
  readonly autoStart?: boolean
}

export async function createService(
  runtime: Runtime,
  options: ServiceOptions = {},
): Promise<Service> {
  const store = openStore({
    file: options.file ?? storePath(writableRoot(runtime)),
    migrations: MIGRATIONS,
  })

  const tasks = new TaskRepository({ db: store.db, events: runtime.events })
  const runs = new RunRepository({ db: store.db, events: runtime.events })
  const projects = new ProjectRepository({ db: store.db, events: runtime.events })

  // Definitions are resolved from the project's own directory, not the one the
  // daemon was started in. Everything that reads or writes a workflow goes
  // through this, so the board, the planner and the scheduler cannot disagree
  // about what a name means.
  const chains = createChains({
    chain: runtime.chain,
    env: runtime.env,
    pathOf: (id) => projects.get(id)?.path,
    events: runtime.events,
  })

  /**
   * Where a task's steps run, and what it is.
   *
   * The rule itself lives in core, beside `taskDirectory` and
   * `defaultWorktreesRoot`, so the diagnostic that reports a missing worktree
   * and the engine that would run in one cannot disagree. What lives here is
   * the plumbing core must not have: which repository holds the project, which
   * filesystem to look on, and how to join a path.
   *
   * Served on the Service so a route needs none of that either. The task
   * detail draws the directory it resolves, and a third copy of these four
   * lines is exactly what moving the rule into core was for.
   */
  const workspace = (task: Task): TaskWorkspace | undefined => {
    const project = task.projectId === undefined ? undefined : projects.get(task.projectId)
    const resolved = workspaceFor(task, project, existsSync, join)
    // Both or neither: core returns nothing precisely when there is no
    // project, so the type can promise the project rather than leave a caller
    // that needs the name to look it up a second time.
    return resolved === undefined || project === undefined
      ? undefined
      : { ...resolved, project }
  }

  /**
   * The same answer as a path the engine can be handed.
   *
   * A task with no project runs where the daemon was started — which is what
   * `factory run` would have used, and the one part of this core cannot know.
   */
  const workspacePathFor = (task: Task): string => workspace(task)?.path ?? runtime.cwd

  /**
   * Where this task's artifacts go.
   *
   * Under the project, deliberately — not under the workspace, which is
   * the worktree when the project uses them. A worktree is deleted when the work
   * in it ends, and an artifact that goes with it is one nobody can read
   * afterwards. A task with no project has nowhere of its own, so it falls back
   * to the directory the daemon was started in, the way everything else does.
   */
  const artifactsFor = (task: Task): string => {
    const project = task.projectId === undefined ? undefined : projects.get(task.projectId)
    const base = project?.path ?? runtime.cwd
    return artifactsRoot(base, task.directory ?? 'local', join)
  }

  const engine = new Engine({
    tasks,
    runs,
    events: runtime.events,
    plan: ({ workflow, task, failure, session }) =>
      planWorkflow({
        chain: chains.for(task.projectId) ?? runtime.chain,
        host: runtime.host,
        workflow,
        workspace: workspacePathFor(task),
        // The daemon has a filesystem, so the boundary check gets the answer
        // that includes symlinks rather than the lexical one core falls back to.
        canonical: systemCanonical,
        // Forwarded, not decided here: the engine owns the session's lifecycle
        // because it is the only thing that sees both the task's recorded one
        // and the run about to start.
        ...(session === undefined ? {} : { session }),
        // Every documented token, every time — including the empty ones, so
        // `{{ task.ticketId }}` on a task with no ticket is blank rather than
        // a warning about a key the dictionary says exists.
        task: taskTokenValues(task, artifactsFor(task)),
        artifacts: artifactsFor(task),
        // Everything a template can say about the surroundings: where the
        // repository is, what branch work starts from, where worktrees go — and,
        // for a recovery workflow, what went wrong.
        project: {
          ...projectVariables(
            task.projectId === undefined ? undefined : projects.get(task.projectId),
          ),
          ...(failure === undefined ? {} : failureVariables(failure)),
        },
      }),
  })

  // Before anything is allowed to start: rows that say "running" from a process
  // that no longer exists have to be corrected first, or the scheduler counts
  // slots that are not in use and the board shows work nobody is doing.
  const reconciliation = reconcile({ tasks, runs })

  // One answer to "what does this workflow say about being scheduled", shared
  // by the scheduler and by the doctor rule that explains why nothing started.
  const workflow = (name: string, projectId?: string): WorkflowFacts | undefined => {
    const chain = chains.for(projectId) ?? runtime.chain
    const found = resolveWorkflow(chain, name)
    if (found?.value === undefined) return undefined
    const project = chain.scopes.find((scope) => scope.kind === 'project')
    return {
      scheduling: found.value.scheduling,
      requires: found.value.conditions?.requires ?? [],
      provides: found.value.conditions?.provides ?? [],
      needs: found.value.needs,
      // Where it came from, and — when it asks to be overridden — where the
      // project's own copy would go, so a warning can name a path rather than
      // leaving someone to work out the filename.
      scope: found.ref.scope,
      ...(found.value.override === undefined ? {} : { override: found.value.override }),
      ...(found.value.override === undefined || project === undefined
        ? {}
        : { overridePath: definitionPath(project, 'workflow', name) }),
    }
  }

  /**
   * What a project says about how much of its work can happen at once.
   *
   * The scheduler takes a lookup rather than the repository, the same way it
   * takes one for workflows: it decides, it does not fetch.
   */
  const project = (id: string): ProjectFacts | undefined => {
    const found = projects.get(id)
    return found === undefined
      ? undefined
      : { name: found.name, usesWorktrees: found.usesWorktrees }
  }

  const scheduler = new Scheduler({
    tasks,
    runs,
    events: runtime.events,
    ...(options.maxParallel === undefined ? {} : { maxParallel: options.maxParallel }),
    start: (taskId) => engine.run(taskId),
    workflow,
    project,
  })

  // Doctor learns about tasks and runs by the same route a plugin would: it
  // registers rules. A process without a database registers none, and doctor
  // still answers about the installation.
  //
  // Through the runtime's own loader, not `host.load` directly: that is the one
  // gate the switches are applied at, and it is also what records the plugin in
  // the catalogue. Loading here would put a plugin in the host that the plugins
  // page cannot see, and a page that omits a loaded plugin is a page that lies.
  await runtime.load(
    runningInstallationPlugin({ tasks, runs, projects, reconciliation, workflow }),
  )

  const stopWatching = options.autoStart === false ? () => {} : scheduler.watch()
  if (options.autoStart !== false) scheduler.tick()

  return {
    store,
    tasks,
    runs,
    projects,
    chains,
    workspace,
    engine,
    scheduler,
    reconciliation,
    close: async () => {
      stopWatching()
      await scheduler.settle()
      store.close()
    },
  }
}

/**
 * What a recovery workflow is told about the failure that called it.
 *
 * Exposed as `{{ project.* }}` because that scope already exists and is meant
 * for facts about the surroundings rather than about the definition. xfactory
 * spelled these `{{ requirement.lastFailureReason }}`; the names are the same
 * ideas under the vocabulary this project settled on.
 */
/**
 * What a step can say about the project it is running in.
 *
 * Typed by `PROJECT_TOKENS` rather than `Record<string, string>`, so the
 * dictionary the builder shows and the values a run actually gets are the same
 * list. Adding a variable here without documenting it does not compile.
 */
const projectVariables = (
  project: Project | undefined,
): Partial<Record<keyof typeof PROJECT_TOKENS, string>> =>
  project === undefined
    ? {}
    : {
        name: project.name,
        path: project.path,
        branch: project.defaultBranch,
        worktrees: project.worktreesRoot,
      }

const failureVariables = (
  failure: FailureContext,
): Record<keyof typeof FAILURE_TOKENS, string> => ({
  failedWorkflow: failure.workflow,
  failedPhase: failure.phase ?? '',
  failureReason: failure.reason,
})

/** The database belongs beside the definitions it is about. */
function writableRoot(runtime: Runtime): string {
  const writable =
    runtime.chain.scopes.find(
      (scope) => scope.writable && scope.kind === runtime.chain.defaultWriteScope,
    ) ?? runtime.chain.scopes.find((scope) => scope.writable)
  if (writable === undefined) {
    throw new Error('No writable scope: Factory has nowhere to keep its state.')
  }
  return writable.root
}
