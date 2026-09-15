import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDER_KIND, type CapabilitySettings } from '@factory/core'
import { Sandbox } from './support.js'
import { providerSettings } from '../src/providers.js'
import { resolveScopes, type ScopeChain } from '../src/scopes.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./provider-config.feature', import.meta.url)),
)

describeFeature(feature, ({ Background, Scenario, AfterEachScenario }) => {
  let box: Sandbox
  let chain: ScopeChain
  let projectScope = ''
  let userScope = ''
  let settings: CapabilitySettings

  AfterEachScenario(() => box.cleanup())

  // Built in Background: the runner executes Background steps first.
  Background(({ Given }) => {
    Given('a project scope and a user scope', () => {
      box = new Sandbox()
      projectScope = box.scope('work', 'project')
      userScope = box.scope('home', 'user')
      chain = resolveScopes({ cwd: box.dir('work', 'src'), env: { FACTORY_HOME: userScope } })
    })
  })

  /** Rewrites a scope's config with a providers block, keeping the kind line. */
  const configure = (scope: string, body: string): void => {
    const kind = scope === projectScope ? 'project' : 'user'
    writeFileSync(
      join(scope, 'config.yaml'),
      `kind: factory.scope/v1\nscope: ${kind}\n${body}`,
    )
  }
  const withCommand = (scope: string, id: string, command: string) =>
    configure(scope, `providers:\n  ${id}:\n    command: ${command}\n`)

  const read = (): void => {
    settings = providerSettings(chain)
  }
  const commandFor = (id: string): unknown => settings[PROVIDER_KIND]?.[id]?.command

  Scenario('nothing configured, nothing to apply', ({ When, Then }) => {
    When('the provider settings are read', read)
    Then('no provider is configured', () => expect(settings).toEqual({}))
  })

  Scenario('the user scope says where the binary is', ({ Given, When, Then }) => {
    Given('the user scope configures "claude" as "/opt/agents/claude"', () =>
      withCommand(userScope, 'claude', '/opt/agents/claude'),
    )
    When('the provider settings are read', read)
    Then('"claude" resolves to "/opt/agents/claude"', () =>
      expect(commandFor('claude')).toBe('/opt/agents/claude'),
    )
  })

  Scenario('the project scope wins', ({ Given, And, When, Then }) => {
    Given('the user scope configures "claude" as "/opt/agents/claude"', () =>
      withCommand(userScope, 'claude', '/opt/agents/claude'),
    )
    And('the project scope configures "claude" as "/repo/bin/claude"', () =>
      withCommand(projectScope, 'claude', '/repo/bin/claude'),
    )
    When('the provider settings are read', read)
    Then('"claude" resolves to "/repo/bin/claude"', () =>
      expect(commandFor('claude')).toBe('/repo/bin/claude'),
    )
  })

  Scenario('a relative path belongs to the scope that wrote it', ({ Given, When, Then }) => {
    Given('the project scope configures "claude" as "./bin/claude"', () =>
      withCommand(projectScope, 'claude', './bin/claude'),
    )
    When('the provider settings are read', read)
    // So a repository can carry the binary it needs.
    Then('"claude" resolves to "bin/claude" inside the project scope', () =>
      expect(commandFor('claude')).toBe(join(projectScope, 'bin', 'claude')),
    )
  })

  Scenario('two providers, two scopes', ({ Given, And, When, Then }) => {
    Given('the user scope configures "codex" as "/opt/agents/codex"', () =>
      withCommand(userScope, 'codex', '/opt/agents/codex'),
    )
    And('the project scope configures "claude" as "/repo/bin/claude"', () =>
      withCommand(projectScope, 'claude', '/repo/bin/claude'),
    )
    When('the provider settings are read', read)
    Then('"claude" resolves to "/repo/bin/claude"', () =>
      expect(commandFor('claude')).toBe('/repo/bin/claude'),
    )
    And('"codex" resolves to "/opt/agents/codex"', () =>
      expect(commandFor('codex')).toBe('/opt/agents/codex'),
    )
  })

  Scenario('nonsense is ignored rather than fatal', ({ Given, When, Then }) => {
    Given('the user scope configures "claude" with an empty command', () =>
      configure(userScope, 'providers:\n  claude:\n    command: ""\n'),
    )
    When('the provider settings are read', read)
    Then('no provider is configured', () => expect(settings).toEqual({}))
  })

  Scenario('a config that will not parse does not stop the others', ({ Given, And, When, Then }) => {
    Given('the project scope has a config that is not valid YAML', () =>
      writeFileSync(join(projectScope, 'config.yaml'), 'kind: [unclosed\n'),
    )
    And('the user scope configures "claude" as "/opt/agents/claude"', () =>
      withCommand(userScope, 'claude', '/opt/agents/claude'),
    )
    When('the provider settings are read', read)
    // Doctor reports the broken file; one bad scope must not blind the rest.
    Then('"claude" resolves to "/opt/agents/claude"', () =>
      expect(commandFor('claude')).toBe('/opt/agents/claude'),
    )
  })
})
