import type { FastifyInstance } from 'fastify'
import {
  exportWorkflow,
  importBundle,
  readBundle,
  type ConflictPolicy,
  type ScopeKind,
} from '@factory/config'
import type { Runtime } from '@factory/runtime'
import type { Chains } from '../chains.js'

/**
 * Export and import, the sharing half of the definition layer.
 *
 * Both take `?project=`: you export the workflow that project actually runs,
 * and an import lands in that project's scope rather than the daemon's.
 */
export function registerBundleRoutes(
  app: FastifyInstance,
  runtime: Runtime,
  chains: Chains,
): void {
  app.post<{ Params: { name: string }; Querystring: { allowMissing?: string; project?: string } }>(
    '/api/workflows/:name/export',
    async (request, reply) => {
      const chain = chains.for(request.query.project)
      if (chain === undefined) {
        return reply.code(404).send({ error: `No project ${request.query.project}.` })
      }
      const result = exportWorkflow({
        chain,
        host: runtime.host,
        name: request.params.name,
        allowMissing: request.query.allowMissing === 'true',
      })
      if (result.text === undefined) return reply.code(400).send({ problems: result.problems })
      return { text: result.text, bundle: result.bundle, problems: result.problems }
    },
  )

  app.post<{
    Body: { text?: string; scope?: ScopeKind; policy?: ConflictPolicy; prefix?: string }
    Querystring: { dryRun?: string; project?: string }
  }>('/api/bundles/import', async (request, reply) => {
    const chain = chains.for(request.query.project)
    if (chain === undefined) {
      return reply.code(404).send({ error: `No project ${request.query.project}.` })
    }
    const text = request.body?.text
    if (typeof text !== 'string') {
      return reply.code(400).send({ error: 'A bundle document is required in "text".' })
    }

    const read = readBundle(text, runtime.host)
    if (read.bundle === undefined) return reply.code(400).send({ problems: read.problems })

    // dryRun runs the same planner and skips the writes, so the preview a user
    // approves is the plan that gets applied -- not a second implementation of
    // it that can drift.
    const result = importBundle({
      chain,
      host: runtime.host,
      bundle: read.bundle,
      dryRun: request.query.dryRun === 'true',
      ...(request.body.scope === undefined ? {} : { scope: request.body.scope }),
      ...(request.body.policy === undefined ? {} : { policy: request.body.policy }),
      ...(request.body.prefix === undefined ? {} : { prefix: request.body.prefix }),
    })

    const blocked = result.problems.some((problem) => problem.severity === 'error')
    return reply.code(blocked ? 409 : 200).send(result)
  })
}
