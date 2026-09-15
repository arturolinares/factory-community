import {
  knownToolDirectories,
  PROVIDER_KIND,
  SETUP_STEP_KIND,
  type FactoryPlugin,
  type ProviderCapability,
  type SetupAction,
  type SetupStepCapability,
} from '@factory/core'
import { listDefinitions } from './store.js'
import { parseWorkflowFile } from '@factory/core'
import { join } from 'node:path'
import { SCOPE_CONFIG_FILE, SCOPE_DIR, type ScopeChain } from './scopes.js'

/**
 * The setup steps that need nothing but files and the environment.
 *
 * Deliberately few. A checklist that lists everything a person could
 * conceivably configure is one they close; this lists what stops Factory doing
 * its job, which on a fresh machine is two things — something to run work with,
 * and somewhere to keep what you write.
 */

/** An agent has to be installed before any of this means anything. */
function agentStep(chain: ScopeChain): SetupStepCapability {
  return {
    id: 'an-agent',
    title: 'Install a coding agent',
    summary: 'Factory runs the agents you already have; it does not contain one.',
    order: 10,
    check({ host, env }) {
      const extraDirectories = knownToolDirectories(env)
      const providers = host.list<ProviderCapability>(PROVIDER_KIND).map((e) => e.capability)
      const found = providers.filter((p) => p.availability(env, { extraDirectories }).available)

      if (found.length > 0) {
        return {
          done: true,
          detail: `${found.map((p) => p.displayName).join(' and ')} ${found.length === 1 ? 'is' : 'are'} installed.`,
        }
      }

      // One action per agent, from the agent's own descriptor — so a plugin
      // that adds a fourth agent appears here without this file changing.
      const actions: SetupAction[] = providers.flatMap((provider) => {
        const install = provider.descriptor.install
        const docs = provider.descriptor.docs
        if (install === undefined && docs === undefined) return []
        return [
          {
            label: `Install ${provider.displayName}`,
            ...(install === undefined ? {} : { command: install }),
            ...(docs === undefined ? {} : { url: docs }),
          },
        ]
      })

      const writable = chain.scopes.find((scope) => scope.writable)
      actions.push({
        label: 'Already installed somewhere unusual? Point Factory at it',
        config:
          `# ${writable?.root ?? join('~', SCOPE_DIR)}/${SCOPE_CONFIG_FILE}\n` +
          `providers:\n  ${providers[0]?.id ?? 'claude'}:\n    command: /full/path/to/${providers[0]?.descriptor.command ?? 'claude'}`,
      })

      return {
        done: false,
        essential: true,
        detail:
          providers.length === 0
            ? 'No agent plugins are installed at all.'
            : `None of ${providers.map((p) => p.displayName).join(', ')} could be found on this machine.`,
        actions,
      }
    },
  }
}

/** Something to run: the built-ins are proof it works, not a pipeline. */
function workflowStep(chain: ScopeChain): SetupStepCapability {
  return {
    id: 'a-workflow',
    title: 'Get a workflow worth running',
    summary: 'The built-in ones prove the installation works. Real work needs one of your own.',
    order: 30,
    check() {
      const workflows = listDefinitions(chain, 'workflow', (text, file) => {
        const parsed = parseWorkflowFile(text, file)
        return { value: parsed.value, problems: parsed.problems }
      })
      const own = workflows.filter((entry) => entry.winner.scope !== 'builtin')

      if (own.length > 0) {
        return { done: true, detail: `${own.length} of your own, plus the built-in ones.` }
      }
      return {
        done: false,
        detail: 'Only the built-in workflows are available.',
        actions: [
          {
            label: 'Import the example pipeline and edit it',
            command:
              'factory bundle import node_modules/@factory/core/examples/development.bundle.yaml',
          },
          { label: 'Or build one in the browser', url: '/workflows/new' },
        ],
      }
    },
  }
}

export function builtinSetupPlugin(chain: ScopeChain): FactoryPlugin {
  return {
    name: '@factory/config/builtin-setup',
    version: '0.1.0',
    register(context) {
      context.provide(SETUP_STEP_KIND, agentStep(chain))
      context.provide(SETUP_STEP_KIND, workflowStep(chain))
    },
  }
}
