import { resolveScopes, type ScopeChain } from '@factory/config'
import type { Runtime } from '@factory/runtime'

/**
 * Which definitions a project can see.
 *
 * Factory resolves definitions through a chain of scopes — the project's own
 * `.factory`, then the user's, then the built-ins — and until now the daemon
 * had exactly one, built at boot from the directory it happened to be started
 * in. That made a workflow committed to a repository unusable by that
 * repository's own tasks unless you launched the daemon inside it, which is
 * precisely the thing nobody does twice.
 *
 * So the chain is a question about a project, not about the process. A request
 * that names no project still gets the daemon's own chain: the CLI, a
 * standalone definition server and every task with no project all depend on it.
 *
 * What this deliberately does *not* do is build a host per project. Provider
 * settings and declared plugins are loaded once at boot and stay
 * installation-wide, so a project may define its own workflows and phases but
 * not its own plugins. Doing that properly means loading and unloading code per
 * request, which is a different change.
 */
export interface Chains {
  /**
   * The chain a project resolves through, or the daemon's own when no project
   * is named. `undefined` means the id belongs to no project — the caller
   * should say so rather than quietly answering about somewhere else.
   */
  for(projectId?: string): ScopeChain | undefined
  /** The daemon's own, for everything that is about the installation. */
  readonly own: ScopeChain
}

export interface ChainsOptions {
  /** The daemon's own chain, from the directory it was started in. */
  readonly chain: ScopeChain
  readonly env: Readonly<Record<string, string | undefined>>
  /** Where a project's working copy is. Absent in a process with no database. */
  readonly pathOf?: (projectId: string) => string | undefined
  /** Listened to so a project that changed is looked up again. */
  readonly events?: Runtime['events']
}

export function createChains(options: ChainsOptions): Chains {
  const cache = new Map<string, ScopeChain>()

  // A project registered before anyone put a `.factory` in it resolves to a
  // chain with no project scope — and would keep resolving to it forever if
  // that answer were cached. Caching only the chains that found something makes
  // the miss self-correcting: the directory appears, the next call sees it.
  const remember = (id: string, chain: ScopeChain): ScopeChain => {
    if (chain.scopes.some((scope) => scope.kind === 'project')) cache.set(id, chain)
    return chain
  }

  const forget = (event: { payload: { projectId: string } }): void => {
    cache.delete(event.payload.projectId)
  }
  options.events?.on('project.changed', forget)
  options.events?.on('project.removed', forget)

  return {
    own: options.chain,
    for(projectId?: string): ScopeChain | undefined {
      if (projectId === undefined) return options.chain
      const cached = cache.get(projectId)
      if (cached !== undefined) return cached

      const path = options.pathOf?.(projectId)
      if (path === undefined) return undefined
      return remember(projectId, resolveScopes({ cwd: path, env: options.env }))
    },
  }
}
