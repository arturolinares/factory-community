import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  assertPluginConformance,
  checkPluginConformance,
  type ConformanceReport,
} from '../src/conformance.js'
import type { FactoryPlugin } from '../src/host.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./plugin-conformance.feature', import.meta.url)),
)

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let plugin: FactoryPlugin
  let report: ConformanceReport
  let thrown: unknown

  const failedChecks = () => report.checks.filter((check) => !check.passed).map((c) => c.name)

  BeforeEachScenario(() => {
    thrown = undefined
    plugin = { name: 'unset', version: '1.0.0', register: () => {} }
  })

  Scenario('A well-formed plugin passes', ({ Given, When, Then, And }) => {
    Given('a plugin "acme-tools" providing the "step-kind" capability "http"', () => {
      plugin = {
        name: 'acme-tools',
        version: '1.0.0',
        register: (context) => context.provide('step-kind', { id: 'http' }),
      }
    })
    When('conformance is checked', async () => {
      report = await checkPluginConformance(plugin)
    })
    Then('the plugin conforms', () => {
      expect(report.passed, failedChecks().join(', ')).toBe(true)
    })
    And('the report says it provides "step-kind:http"', () => {
      expect(report.provides).toContain('step-kind:http')
    })
  })

  Scenario('A plugin that only registers a hook still conforms', ({ Given, When, Then, And }) => {
    Given('a plugin "acme-policy" that registers only a "validateDefinition" hook', () => {
      plugin = {
        name: 'acme-policy',
        version: '1.0.0',
        register: (context) => context.hook('validateDefinition', () => []),
      }
    })
    When('conformance is checked', async () => {
      report = await checkPluginConformance(plugin)
    })
    Then('the plugin conforms', () => {
      expect(report.passed, failedChecks().join(', ')).toBe(true)
    })
    And('the report says it registers the "validateDefinition" hook', () => {
      expect(report.hooks).toContain('validateDefinition')
    })
  })

  Scenario('A plugin that contributes nothing fails', ({ Given, When, Then, And }) => {
    Given('a plugin "inert" that registers nothing', () => {
      plugin = { name: 'inert', version: '1.0.0', register: () => {} }
    })
    When('conformance is checked', async () => {
      report = await checkPluginConformance(plugin)
    })
    Then('the plugin does not conform', () => {
      expect(report.passed).toBe(false)
    })
    And('the failing check is "registers without throwing"', () => {
      expect(failedChecks()).toContain('registers without throwing')
    })
  })

  Scenario('A plugin with an invalid capability id fails', ({ Given, When, Then }) => {
    Given('a plugin "shouty" providing the "step-kind" capability "HTTP"', () => {
      plugin = {
        name: 'shouty',
        version: '1.0.0',
        register: (context) => context.provide('step-kind', { id: 'HTTP' }),
      }
    })
    When('conformance is checked', async () => {
      report = await checkPluginConformance(plugin)
    })
    Then('the plugin does not conform', () => {
      expect(report.passed).toBe(false)
    })
  })

  Scenario('A plugin with no version fails', ({ Given, When, Then, And }) => {
    Given(
      'a plugin "acme-tools" providing the "step-kind" capability "http" with no version',
      () => {
        plugin = {
          name: 'acme-tools',
          version: '',
          register: (context) => context.provide('step-kind', { id: 'http' }),
        }
      },
    )
    When('conformance is checked', async () => {
      report = await checkPluginConformance(plugin)
    })
    Then('the plugin does not conform', () => {
      expect(report.passed).toBe(false)
    })
    And('the failing check is "has a version"', () => {
      expect(failedChecks()).toContain('has a version')
    })
  })

  Scenario(
    'A plugin holding module-level state fails the fresh-host check',
    ({ Given, When, Then, And }) => {
      Given('a plugin "leaky" that only registers its capability the first time', () => {
        // The bug this check exists to catch: state that outlives one host, so
        // the second load behaves differently. Invisible in a single-host test,
        // and it breaks the daemon on reload.
        let alreadyRegistered = false
        plugin = {
          name: 'leaky',
          version: '1.0.0',
          register(context) {
            context.hook('validateDefinition', () => [])
            if (alreadyRegistered) return
            alreadyRegistered = true
            context.provide('step-kind', { id: 'http' })
          },
        }
      })
      When('conformance is checked', async () => {
        report = await checkPluginConformance(plugin)
      })
      Then('the plugin does not conform', () => {
        expect(report.passed).toBe(false)
      })
      And('the failing check is "registers identically into a fresh host"', () => {
        expect(failedChecks()).toContain('registers identically into a fresh host')
      })
    },
  )

  Scenario('The throwing form reports every failing check', ({ Given, When, Then, And }) => {
    Given('a plugin "inert" that registers nothing', () => {
      plugin = { name: 'inert', version: '1.0.0', register: () => {} }
    })
    When('conformance is asserted', async () => {
      try {
        await assertPluginConformance(plugin)
      } catch (error) {
        thrown = error
      }
    })
    Then('the assertion throws', () => {
      expect(thrown).toBeInstanceOf(Error)
    })
    And('the message names the plugin', () => {
      expect((thrown as Error).message).toContain('inert')
    })
  })
})
