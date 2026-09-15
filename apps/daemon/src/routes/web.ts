import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * Serving the board from the daemon.
 *
 * In development Vite serves the app and proxies `/api` here. In use there is
 * no Vite: one process, one address, one thing to start. Local-first has to
 * mean local-first to install as well as to run.
 *
 * Written by hand rather than with a static-file plugin. It is forty lines, and
 * a tool people are asked to install on their own machine should carry as few
 * dependencies as it can honestly manage.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export function registerWebRoutes(app: FastifyInstance, root: string): void {
  const base = resolve(root)

  app.get('/*', async (request, reply) => {
    const url = (request.params as { '*'?: string })['*'] ?? ''

    // Never serve anything outside the build directory. `normalize` collapses
    // `..` before the check, so a path that climbs out is caught here rather
    // than by whatever it reaches.
    const candidate = resolve(join(base, normalize(`/${url}`)))
    if (candidate !== base && !candidate.startsWith(base + sep)) {
      return reply.code(404).send({ error: 'Not found.' })
    }

    const file =
      existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : // Anything else is a route the app handles itself: /tasks/abc is a
          // page, not a missing file, and the app router resolves it.
          join(base, 'index.html')

    if (!existsSync(file)) return reply.code(404).send({ error: 'Not found.' })

    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    // Hashed asset names may be cached hard; index.html never, or a deploy is
    // invisible until someone clears their cache.
    const cache = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
    return reply.type(type).header('cache-control', cache).send(createReadStream(file))
  })
}

/**
 * Where the built board might be.
 *
 * Checked in order, and a missing build is not an error: the API is useful on
 * its own, and saying so beats refusing to start.
 */
export function findWebRoot(options: {
  env: Readonly<Record<string, string | undefined>>
  /** This module's own location, so the search does not depend on the cwd. */
  here: string
}): string | undefined {
  const candidates = [
    options.env.FACTORY_WEB_ROOT,
    // A published daemon carrying the built app beside its code.
    resolve(options.here, 'web'),
    resolve(options.here, '..', 'web'),
    // The monorepo: apps/daemon/dist -> apps/web/dist.
    resolve(options.here, '..', '..', 'web', 'dist'),
  ]
  return candidates.find(
    (path) => path !== undefined && existsSync(join(path, 'index.html')),
  )
}
