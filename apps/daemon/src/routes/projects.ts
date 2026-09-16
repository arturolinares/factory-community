import type { FastifyInstance } from 'fastify'
import { scaffoldProjectDefinitions } from '@factory/config'
import { EXECUTION_PROFILES, isExecutionProfile } from '@factory/core'
import type { ExecutionProfile, Project, ProjectSetting } from '@factory/core'
import type { Runtime } from '@factory/runtime'
import type { Service } from '../service.js'

/** What scaffolding did, or why it could not. */
interface ScaffoldReport {
  readonly written: readonly string[]
  readonly kept: readonly string[]
  readonly missing: readonly string[]
  readonly error?: string
}

/** One report from however many settings were touched. */
const merge = (reports: readonly (ScaffoldReport | undefined)[]): ScaffoldReport => {
  const present = reports.filter((report): report is ScaffoldReport => report !== undefined)
  const error = present.find((report) => report.error !== undefined)?.error
  return {
    written: present.flatMap((report) => report.written),
    kept: present.flatMap((report) => report.kept),
    missing: present.flatMap((report) => report.missing),
    ...(error === undefined ? {} : { error }),
  }
}

/**
 * Projects over HTTP.
 *
 * The repository does the checking — the path exists, it is a directory, the
 * name is free — so a bad request comes back as the sentence the repository
 * wrote rather than a second set of rules kept here that could disagree with it.
 */
export function registerProjectRoutes(
  app: FastifyInstance,
  service: Service,
  runtime: Runtime,
): void {
  const { projects, tasks, chains } = service

  /**
   * Put the definitions a setting needs into the project, and say what landed.
   *
   * Done here rather than in the repository because the repository writes rows
   * and this writes files — and because it needs the project's own scope chain,
   * which only the daemon can resolve.
   *
   * Failing to scaffold does not fail the request. The setting is a database
   * fact and it was set; not being able to write into someone's repository —
   * read-only checkout, permissions, a `.factory` that is a file — is worth
   * reporting, not worth undoing their change over.
   */
  const scaffold = (project: Project, setting: ProjectSetting) => {
    const chain = chains.for(project.id)
    if (chain === undefined) return undefined
    try {
      return scaffoldProjectDefinitions({ chain, host: runtime.host, setting })
    } catch (error) {
      return {
        written: [],
        kept: [],
        missing: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  app.get('/api/projects', async () => ({
    items: projects.list().map((project) => ({
      ...project,
      // What a person actually wants to know next to a project: is anything
      // happening in it.
      tasks: tasks.list().filter((task) => task.projectId === project.id).length,
    })),
  }))

  app.post<{
    Body: {
      name?: string
      path?: string
      defaultBranch?: string
      worktreesRoot?: string
      usesWorktrees?: boolean
      usesEnvironments?: boolean
    }
  }>(
    '/api/projects',
    async (request, reply) => {
      const body = request.body ?? {}
      if (typeof body.name !== 'string' || typeof body.path !== 'string') {
        return reply.code(400).send({ error: 'Send { name, path }.' })
      }
      try {
        const project = projects.add({
          name: body.name,
          path: body.path,
          ...(body.defaultBranch === undefined ? {} : { defaultBranch: body.defaultBranch }),
          ...(body.worktreesRoot === undefined ? {} : { worktreesRoot: body.worktreesRoot }),
          ...(body.usesWorktrees === undefined ? {} : { usesWorktrees: body.usesWorktrees }),
          ...(body.usesEnvironments === undefined
            ? {}
            : { usesEnvironments: body.usesEnvironments }),
        })
        // Whatever it was registered with, it gets the files for.
        const scaffolded = [
          ...(project.usesWorktrees ? [scaffold(project, 'worktrees')] : []),
          ...(project.usesEnvironments ? [scaffold(project, 'environments')] : []),
        ]
        return reply.code(201).send({ project, scaffolded: merge(scaffolded) })
      } catch (error) {
        // A path that does not exist or a name already taken is a mistake in
        // the request, not a failure of the server.
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
      }
    },
  )

  /**
   * Change a project.
   *
   * A separate route rather than "remove and add again", which would null the
   * `project_id` of every task that ever ran in it — the record of the work
   * would survive, pointing at nothing.
   *
   * Allowed while the project has work in flight: tasks already running finish
   * where they are, and the new rule applies to whatever starts next.
   */
  app.patch<{
    Params: { id: string }
    Body: { usesWorktrees?: boolean; usesEnvironments?: boolean; profile?: unknown }
  }>('/api/projects/:id', async (request, reply) => {
    if (projects.get(request.params.id) === undefined) {
      return reply.code(404).send({ error: `No project ${request.params.id}.` })
    }
    const { usesWorktrees, usesEnvironments, profile } = request.body ?? {}
    const settingProfile = 'profile' in (request.body ?? {})
    if (usesWorktrees === undefined && usesEnvironments === undefined && !settingProfile) {
      return reply.code(400).send({
        error:
          'Send { usesWorktrees } or { usesEnvironments }, true or false, ' +
          'or { profile } to say how much authority its runs get.',
      })
    }
    // `null` clears it, which is not the same as `default`: a project that
    // states nothing follows the installation's choice, and returning to that
    // has to be expressible.
    if (settingProfile && profile !== null && !isExecutionProfile(profile)) {
      return reply.code(400).send({
        error: `profile is ${EXECUTION_PROFILES.join(', ')} or null to follow the installation.`,
      })
    }
    if (
      (usesWorktrees !== undefined && typeof usesWorktrees !== 'boolean') ||
      (usesEnvironments !== undefined && typeof usesEnvironments !== 'boolean')
    ) {
      return reply.code(400).send({ error: 'Settings are true or false.' })
    }

    try {
      let project = projects.get(request.params.id) as Project
      const scaffolded: (ScaffoldReport | undefined)[] = []

      if (usesWorktrees !== undefined) {
        project = projects.setWorktrees(request.params.id, usesWorktrees)
        // Only on the way on. Turning a setting off leaves the files where they
        // are: they are the project's now, and deleting someone's committed
        // workflow because they flipped a checkbox would be unforgivable.
        if (usesWorktrees) scaffolded.push(scaffold(project, 'worktrees'))
      }
      if (usesEnvironments !== undefined) {
        project = projects.setEnvironments(request.params.id, usesEnvironments)
        if (usesEnvironments) scaffolded.push(scaffold(project, 'environments'))
      }
      if (settingProfile) {
        // Nothing is scaffolded for a profile: it changes what the next run is
        // *given*, not what the repository contains.
        project = projects.setProfile(
          request.params.id,
          profile === null ? undefined : (profile as ExecutionProfile),
        )
      }

      return { project, scaffolded: merge(scaffolded) }
    } catch (error) {
      // "That directory is not a git repository" is a fact about the request.
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    if (!projects.remove(request.params.id)) {
      return reply.code(404).send({ error: `No project ${request.params.id}.` })
    }
    return reply.code(204).send()
  })
}
