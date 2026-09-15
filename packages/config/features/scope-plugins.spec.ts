import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventBus } from '@factory/events'
import { CapabilityHost } from '@factory/core'
import { Sandbox } from './support.js'
import { resolveScopes, type ScopeChain } from '../src/scopes.js'
import {
  loadCatalogue,
  pluginCatalogue,
  type PluginCandidate,
} from '../src/plugins.js'
import type { FactoryPlugin, Problem } from '@factory/core'

const feature = await loadFeature(
  fileURLToPath(new URL('./scope-plugins.feature', import.meta.url)),
)

/** A real plugin module on disk, since the loader genuinely imports it. */
const HTTP_PLUGIN = `
export default {
  name: 'acme-http',
  version: '1.0.0',
  register(context) {
    context.provide('step-kind', { id: 'http', summary: 'Makes an HTTP request.' })
  },
}
`

describeFeature(feature, ({ Scenario, Rule, BeforeEachScenario, AfterEachScenario }) => {
  let box: Sandbox
  let host: CapabilityHost
  let chain: ScopeChain
  let projectScopeRoot = ''
  let declared: string[] = []
  let builtins: FactoryPlugin[] = []
  let essential: string[] = []
  let disabled: string[] = []
  let catalogue: PluginCandidate[] = []
  let problems: readonly Problem[] = []
  /** Stands in for `loaded`, which the catalogue carries per entry. */
  let loaded: string[] = []

  BeforeEachScenario(() => {
    box = new Sandbox()
    host = new CapabilityHost({ events: new EventBus({ onSubscriberError: () => {} }) })
    projectScopeRoot = box.scope('work')
    declared = []
    builtins = []
    essential = []
    disabled = []
    catalogue = []
    problems = []
    loaded = []
  })
  AfterEachScenario(() => box.cleanup())

  const writeScopeConfig = () => {
    const plugins = declared.map((entry) => `  - ${entry}`).join('\n')
    writeFileSync(
      join(projectScopeRoot, 'config.yaml'),
      `kind: factory.scope/v1\nscope: project\n${declared.length > 0 ? `plugins:\n${plugins}\n` : ''}`,
    )
  }

  const addHttpPlugin = () => {
    box.file(join('work', '.xaedalon', '.factory', 'plugins', 'http.mjs'), HTTP_PLUGIN)
    declared.push('./plugins/http.mjs')
    writeScopeConfig()
  }

  const load = async () => {
    chain = resolveScopes({
      cwd: box.dir('work', 'src'),
      env: { FACTORY_HOME: box.scope('home', 'user') },
    })
    const built = pluginCatalogue({ chain, builtins, essential, disabled })
    const settled = await loadCatalogue({
      catalogue: built,
      host,
      chain,
      builtins: new Map(builtins.map((plugin) => [plugin.name, plugin])),
    })
    catalogue = settled.catalogue
    problems = settled.problems
    loaded = catalogue.filter((entry) => entry.loaded).map((entry) => entry.name ?? entry.id)
  }

  const entry = (id: string): PluginCandidate | undefined =>
    catalogue.find((candidate) => candidate.id === id)

  Scenario('A plugin declared by the project scope is loaded', ({ Given, When, Then, And }) => {
    Given('the project scope declares a plugin that adds a "http" step kind', addHttpPlugin)
    When('the catalogue is loaded', load)
    Then('the plugin is loaded', () => expect(loaded).toContain('acme-http'))
    And('the host has a "step-kind" capability "http"', () =>
      expect(host.has('step-kind', 'http')).toBe(true),
    )
    And('there are no problems', () => expect(problems).toHaveLength(0))
  })

  Scenario('A missing plugin file is reported, not thrown', ({ Given, When, Then, And }) => {
    Given('the project scope declares a plugin that does not exist', () => {
      declared.push('./plugins/absent.mjs')
      writeScopeConfig()
    })
    When('the catalogue is loaded', load)
    Then('no plugin is loaded', () => expect(loaded).toHaveLength(0))
    And('a problem names the plugin', () =>
      expect(problems[0]?.message).toContain('absent.mjs'),
    )
    And('the problem points at the scope config', () =>
      expect(problems[0]?.file?.endsWith('config.yaml')).toBe(true),
    )
  })

  Scenario('A module with no plugin export is reported', ({ Given, When, Then, And }) => {
    Given('the project scope declares a module that exports nothing useful', () => {
      box.file(join('work', '.xaedalon', '.factory', 'plugins', 'empty.mjs'), 'export const unrelated = 1\n')
      declared.push('./plugins/empty.mjs')
      writeScopeConfig()
    })
    When('the catalogue is loaded', load)
    Then('no plugin is loaded', () => expect(loaded).toHaveLength(0))
    And('a problem mentions the missing export', () =>
      expect(problems[0]?.message).toContain('no Factory plugin export'),
    )
  })

  Scenario('One broken plugin does not stop the others', ({ Given, And, When, Then }) => {
    Given('the project scope declares a plugin that does not exist', () => {
      declared.push('./plugins/absent.mjs')
      writeScopeConfig()
    })
    And('the project scope also declares a plugin that adds a "http" step kind', addHttpPlugin)
    When('the catalogue is loaded', load)
    Then('the plugin is loaded', () => expect(loaded).toContain('acme-http'))
    And('exactly 1 problem is reported', () => expect(problems).toHaveLength(1))
  })

  Scenario('A scope with no plugins declared contributes none', ({ Given, When, Then, And }) => {
    Given('the project scope declares no plugins', writeScopeConfig)
    When('the catalogue is loaded', load)
    Then('no plugin is loaded', () => expect(loaded).toHaveLength(0))
    And('there are no problems', () => expect(problems).toHaveLength(0))
  })

  Rule('a plugin switched off is never imported', ({ RuleScenario }) => {
    /**
     * A module with a side effect, so "was it imported" is observable.
     *
     * The only honest test of "not loaded" is something that did not happen.
     * A flag set inside `register` would not do: a disabled plugin must not be
     * *imported*, and importing runs the module body.
     */
    const MARKER = 'loaded.txt'
    const witness = (marker: string) => `
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(marker)}, 'yes')
export default {
  name: 'acme-witness',
  version: '1.0.0',
  register(context) {
    context.provide('step-kind', { id: 'witness', summary: 'Proves it loaded.' })
  },
}
`
    let markerPath = ''

    const givenWitness = () => {
      markerPath = box.path(MARKER)
      box.file(
        join('work', '.xaedalon', '.factory', 'plugins', 'witness.mjs'),
        witness(markerPath),
      )
      declared.push('./plugins/witness.mjs')
      writeScopeConfig()
    }
    const builtin = (name: string): FactoryPlugin => ({
      name,
      version: '1.0.0',
      register: (context) => {
        context.provide('step-kind', { id: name, summary: 'A built-in.' })
      },
    })

    RuleScenario('A declared plugin that is switched off is never imported', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the project scope declares a plugin that writes a file when it loads', givenWitness)
      And('that plugin is switched off', () => {
        disabled = ['./plugins/witness.mjs']
      })
      When('the catalogue is loaded', load)
      Then('the file it would have written is not there', () =>
        expect(existsSync(markerPath)).toBe(false),
      )
      And('it is listed as switched off', () =>
        expect(entry('./plugins/witness.mjs')?.enabled).toBe(false),
      )
      And('nothing was loaded', () => expect(loaded).toEqual([]))
    })

    RuleScenario('The same plugin left on does load, so the check above means something', ({
      Given,
      When,
      Then,
    }) => {
      Given('the project scope declares a plugin that writes a file when it loads', givenWitness)
      When('the catalogue is loaded', load)
      Then('the file it would have written is there', () =>
        expect(existsSync(markerPath)).toBe(true),
      )
    })

    RuleScenario('A declared plugin is named by its specifier', ({ Given, When, Then, And }) => {
      Given('the project scope declares a plugin that adds a "http" step kind', addHttpPlugin)
      When('the catalogue is loaded', load)
      Then('it is listed as "./plugins/http.mjs"', () =>
        expect(entry('./plugins/http.mjs')).toBeDefined(),
      )
      And('its name is known now that it has loaded', () =>
        expect(entry('./plugins/http.mjs')?.name).toBe('acme-http'),
      )
    })

    RuleScenario('A built-in is named by its manifest name', ({ Given, When, Then }) => {
      Given('a built-in plugin "acme-builtin"', () => {
        builtins = [builtin('acme-builtin')]
        writeScopeConfig()
      })
      When('the catalogue is loaded', load)
      Then('it is listed as "acme-builtin"', () =>
        expect(entry('acme-builtin')?.source).toBe('builtin'),
      )
    })

    RuleScenario('An essential plugin stays on however the file was edited', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a built-in plugin "acme-builtin" that is essential', () => {
        builtins = [builtin('acme-builtin')]
        essential = ['acme-builtin']
        writeScopeConfig()
      })
      And('"acme-builtin" is switched off', () => {
        disabled = ['acme-builtin']
      })
      When('the catalogue is loaded', load)
      Then('"acme-builtin" is listed as still on', () =>
        expect(entry('acme-builtin')?.enabled).toBe(true),
      )
      And('it was loaded', () => expect(loaded).toContain('acme-builtin'))
    })

    RuleScenario('An id nothing claims any more is kept and listed', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('"@acme/long-gone" is switched off', () => {
        disabled = ['@acme/long-gone']
        writeScopeConfig()
      })
      When('the catalogue is loaded', load)
      Then('"@acme/long-gone" is listed as unknown', () =>
        expect(entry('@acme/long-gone')?.source).toBe('unknown'),
      )
      And('"@acme/long-gone" is listed as switched off', () =>
        expect(entry('@acme/long-gone')?.enabled).toBe(false),
      )
    })
  })
})
