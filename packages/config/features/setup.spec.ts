import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { chmodSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventBus } from '@factory/events'
import {
  CapabilityHost,
  PROVIDER_KIND,
  providerFromDescriptor,
  runSetup,
  SETUP_STEP_KIND,
  type FactoryPlugin,
  type ProviderDescriptor,
  type SetupItem,
  type SetupReport,
} from '@factory/core'
import { Sandbox } from './support.js'
import { builtinSetupPlugin } from '../src/setup.js'
import { resolveScopes, type ScopeChain } from '../src/scopes.js'

const feature = await loadFeature(fileURLToPath(new URL('./setup.feature', import.meta.url)))

describeFeature(feature, ({ Background, Scenario, AfterEachScenario }) => {
  let box: Sandbox
  let chain: ScopeChain
  let host: CapabilityHost
  let env: Record<string, string | undefined>
  let report: SetupReport
  let extra: FactoryPlugin | undefined

  AfterEachScenario(() => box.cleanup())

  // Built in Background: the runner executes Background steps first.
  Background(({ Given, And }) => {
    Given('a project scope and a user scope', () => {
      box = new Sandbox()
      box.scope('work', 'project')
      chain = resolveScopes({
        cwd: box.dir('work', 'src'),
        env: { FACTORY_HOME: box.scope('home', 'user') },
      })
      // No HOME and no PATH: nothing is discovered unless a scenario installs
      // it, so the result cannot depend on the machine running the suite.
      env = { PATH: '' }
      extra = undefined
    })
    And('the built-in setup steps are registered', () => {
      host = new CapabilityHost({ events: new EventBus({ onSubscriberError: () => {} }), env })
    })
  })

  const descriptor = (over: Partial<ProviderDescriptor> = {}): ProviderDescriptor =>
    ({
      id: 'claude',
      displayName: 'Claude Code',
      summary: "Anthropic's coding agent.",
      command: 'claude',
      supports: [],
      models: {},
      permissionArgs: [],
      extraArgs: [],
      provisional: false,
      ...over,
    }) as unknown as ProviderDescriptor

  const providerPlugin = (over: Partial<ProviderDescriptor> = {}): FactoryPlugin => ({
    name: 'test-provider',
    version: '1.0.0',
    register: (context) =>
      context.provide(PROVIDER_KIND, providerFromDescriptor(descriptor(over))),
  })

  const check = async (): Promise<void> => {
    await host.load(builtinSetupPlugin(chain))
    if (extra !== undefined) await host.load(extra)
    report = await runSetup({ host, env })
  }
  const item = (id: string): SetupItem | undefined =>
    report.items.find((entry) => entry.id === id)

  Scenario('a fresh machine with nothing installed', ({ Given, When, Then, And }) => {
    Given('no agent is installed', () => {
      // Nothing registered, nothing on PATH.
    })
    When('setup is checked', check)
    Then('"an-agent" is not done', () => expect(item('an-agent')?.done).toBe(false))
    And('it is marked essential', () => expect(item('an-agent')?.essential).toBe(true))
    And('the installation is not ready', () => expect(report.ready).toBe(false))
  })

  const givenDocumentedProvider = async (): Promise<void> => {
    await host.load(
      providerPlugin({
        install: 'npm install -g @anthropic-ai/claude-code',
        docs: 'https://docs.claude.com/en/docs/claude-code',
      }),
    )
  }

  Scenario('it says how to install each agent it knows about', ({ Given, And, When, Then }) => {
    Given('no agent is installed', () => {})
    And('a provider "claude" that documents how it is installed', givenDocumentedProvider)
    When('setup is checked', check)
    // From the agent's own descriptor, so a fourth agent needs no change here.
    Then('"an-agent" offers to install "Claude Code"', () =>
      expect(item('an-agent')?.actions?.some((a) => a.label.includes('Claude Code'))).toBe(true),
    )
    And('the offer carries the install command', () =>
      expect(item('an-agent')?.actions?.[0]?.command).toContain('npm install'),
    )
    And('the offer carries a link to its documentation', () =>
      expect(item('an-agent')?.actions?.[0]?.url).toContain('docs.claude.com'),
    )
  })

  Scenario('it offers the way out for an agent installed somewhere unusual', ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('no agent is installed', () => {})
    And('a provider "claude" that documents how it is installed', givenDocumentedProvider)
    When('setup is checked', check)
    Then('"an-agent" offers to point Factory at an existing install', () =>
      expect(item('an-agent')?.actions?.some((a) => a.config !== undefined)).toBe(true),
    )
    And('the offer shows the configuration to write', () =>
      expect(item('an-agent')?.actions?.at(-1)?.config).toContain('providers:'),
    )
  })

  const givenInstalled = async (): Promise<void> => {
    const bin = box.dir('bin')
    const file = join(bin, 'claude')
    writeFileSync(file, '#!/bin/sh\n')
    chmodSync(file, 0o755)
    env.PATH = [bin].join(delimiter)
    await host.load(providerPlugin())
  }

  Scenario('an installed agent finishes the step', ({ Given, When, Then, And }) => {
    Given('"claude" is installed and on PATH', givenInstalled)
    When('setup is checked', check)
    Then('"an-agent" is done', () => expect(item('an-agent')?.done).toBe(true))
    And('the detail names "Claude Code"', () =>
      expect(item('an-agent')?.detail).toContain('Claude Code'),
    )
  })

  Scenario('the built-in workflows are not a pipeline', ({ Given, When, Then, And }) => {
    Given('no workflow of your own', () => {})
    When('setup is checked', check)
    Then('"a-workflow" is not done', () => expect(item('a-workflow')?.done).toBe(false))
    // An improvement, not a blocker: a checklist that treats them alike is one
    // people learn to ignore.
    And('it is not marked essential', () => expect(item('a-workflow')?.essential).toBeUndefined())
    And('it offers to import the example', () =>
      expect(item('a-workflow')?.actions?.[0]?.command).toContain('bundle import'),
    )
  })

  Scenario('a workflow of your own finishes the step', ({ Given, When, Then }) => {
    Given('the project defines a workflow "development"', () => {
      box.file(
        join('work', '.xaedalon', '.factory', 'workflows', 'development.workflow.yaml'),
        'name: development\nphases: []\n',
      )
    })
    When('setup is checked', check)
    Then('"a-workflow" is done', () => expect(item('a-workflow')?.done).toBe(true))
  })

  Scenario('ready means nothing essential is outstanding', ({ Given, And, When, Then }) => {
    Given('"claude" is installed and on PATH', givenInstalled)
    And('no workflow of your own', () => {})
    When('setup is checked', check)
    Then('the installation is ready', () => expect(report.ready).toBe(true))
    And('1 step is still outstanding', () => expect(report.remaining).toBe(1))
  })

  Scenario('a step that throws is reported rather than losing the list', ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('a plugin whose setup step throws', () => {
      extra = {
        name: 'broken-setup',
        version: '1.0.0',
        register: (context) =>
          context.provide(SETUP_STEP_KIND, {
            id: 'broken',
            title: 'Something else',
            summary: 'Throws.',
            check: () => {
              throw new Error('no idea')
            },
          }),
      }
    })
    And('"claude" is installed and on PATH', givenInstalled)
    When('setup is checked', check)
    // A checklist that vanishes because one plugin misbehaved is worse than one
    // with an ugly entry in it.
    Then('the broken step is reported as not done', () => {
      expect(item('broken')?.done).toBe(false)
      expect(item('broken')?.detail).toContain('no idea')
    })
    And('the other steps are still listed', () => expect(report.items.length).toBe(3))
  })
})
