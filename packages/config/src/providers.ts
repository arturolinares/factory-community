import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PROVIDER_KIND, type CapabilitySettings } from '@factory/core'
import { SCOPE_CONFIG_FILE, type ScopeChain } from './scopes.js'

/**
 * What a scope says about the agents on this machine.
 *
 * ```yaml
 * # ~/.xaedalon/.factory/config.yaml
 * providers:
 *   claude:
 *     command: /opt/agents/claude-nightly
 * ```
 *
 * This is the layer that makes Factory work on a machine nobody anticipated.
 * Discovery covers the ordinary cases — PATH, then the handful of places things
 * are usually installed — and this covers everything else, which on somebody
 * else's computer is a category that always turns out to be non-empty.
 *
 * It resolves through the same chain as definitions, so a project can pin an
 * exact binary for a repository that needs one, and a user scope can say where
 * their own machine keeps things. Project wins, as everywhere else.
 */

export interface ProviderConfig {
  /** Absolute path to the executable. Relative is resolved against the scope. */
  readonly command?: string
}

/** Provider configuration from every scope, highest precedence first. */
export function providerSettings(chain: ScopeChain): CapabilitySettings {
  const byId: Record<string, Record<string, unknown>> = {}

  // Lowest precedence first, so a nearer scope overwrites what it shadows.
  for (const scope of [...chain.scopes].reverse()) {
    const file = resolvePath(scope.root, SCOPE_CONFIG_FILE)
    if (!existsSync(file)) continue

    let parsed: { providers?: unknown } | null
    try {
      parsed = parseYaml(readFileSync(file, 'utf8')) as { providers?: unknown } | null
    } catch {
      continue // reported by the scope-config doctor rule
    }

    const providers = parsed?.providers
    if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) continue

    for (const [id, value] of Object.entries(providers as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const command = (value as ProviderConfig).command
      if (typeof command !== 'string' || command.trim() === '') continue

      // A relative path belongs to the scope that wrote it, the same rule the
      // plugin list follows — so a project can carry a binary in its own repo.
      byId[id] = { command: resolvePath(scope.root, command.trim()) }
    }
  }

  return Object.keys(byId).length === 0 ? {} : { [PROVIDER_KIND]: byId }
}
