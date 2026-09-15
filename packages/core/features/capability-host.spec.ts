import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { EventBus } from '@factory/events'
import { CapabilityHost, type FactoryPlugin } from '../src/host.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./capability-host.feature', import.meta.url)),
)

/** A plugin that provides one capability of one kind. */
const providing = (name: string, kind: string, ...ids: string[]): FactoryPlugin => ({
  name,
  version: '1.0.0',
  register(context) {
    for (const id of ids) context.provide(kind, { id, displayName: id })
  },
})

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let host: CapabilityHost
  let plugin: FactoryPlugin
  let failure: unknown

  const load = async (candidate: FactoryPlugin) => {
    try {
      await host.load(candidate)
    } catch (error) {
      failure = error
    }
  }
  const message = () => (failure instanceof Error ? failure.message : String(failure))

  BeforeEachScenario(() => {
    failure = undefined
    host = new CapabilityHost({ events: new EventBus({ onSubscriberError: () => {} }) })
    plugin = providing('unset', 'step-kind', 'unset')
  })

  Scenario("A plugin's capability is discoverable once loaded", ({ Given, When, Then, And }) => {
    Given('a plugin "acme-tools" providing the "step-kind" capability "http"', () => {
      plugin = providing('acme-tools', 'step-kind', 'http')
    })
    When('the plugin is loaded', async () => {
      await load(plugin)
    })
    Then('the host has a "step-kind" capability "http"', () => {
      expect(host.has('step-kind', 'http')).toBe(true)
    })
    And('listing "step-kind" capabilities returns 1 entry', () => {
      expect(host.list('step-kind')).toHaveLength(1)
    })
    And('the "http" capability is attributed to "acme-tools"', () => {
      expect(host.list('step-kind')[0]?.plugin).toBe('acme-tools')
    })
    And('the host reports "acme-tools" among its loaded plugins', () => {
      expect(host.plugins().map((p) => p.name)).toContain('acme-tools')
    })
  })

  Scenario('A capability kind core has never heard of still loads', ({ Given, When, Then, And }) => {
    Given('a plugin "acme-desktop" providing the "desktop" capability "shell"', () => {
      plugin = providing('acme-desktop', 'desktop', 'shell')
    })
    When('the plugin is loaded', async () => {
      await load(plugin)
    })
    Then('the host has a "desktop" capability "shell"', () => {
      expect(host.has('desktop', 'shell')).toBe(true)
    })
    And('the host lists "desktop" among its capability kinds', () => {
      expect(host.kinds()).toContain('desktop')
    })
  })

  Scenario('An absent capability is simply absent', ({ Given, Then, And }) => {
    Given('no plugins are loaded', () => {
      expect(host.plugins()).toHaveLength(0)
    })
    Then('the host does not have a "desktop" capability', () => {
      expect(host.has('desktop')).toBe(false)
    })
    And('getting the "desktop" capability returns nothing', () => {
      expect(host.get('desktop')).toBeUndefined()
    })
  })

  Scenario('Two plugins cannot claim the same capability id', ({ Given, And, When, Then }) => {
    Given('a plugin "acme-tools" providing the "step-kind" capability "http"', () => {
      plugin = providing('acme-tools', 'step-kind', 'http')
    })
    And('the plugin is loaded', async () => {
      await load(plugin)
    })
    When('a plugin "rival-tools" providing the "step-kind" capability "http" is loaded', async () => {
      await load(providing('rival-tools', 'step-kind', 'http'))
    })
    Then('loading fails', () => {
      expect(failure).toBeDefined()
    })
    And('the error names the plugin that already provides it', () => {
      expect(message()).toContain('acme-tools')
    })
  })

  Scenario('A plugin that fails partway registers nothing', ({ Given, When, Then, And }) => {
    Given('a plugin "half-broken" that provides "step-kind" capability "good" and then throws', () => {
      plugin = {
        name: 'half-broken',
        version: '1.0.0',
        register(context) {
          context.provide('step-kind', { id: 'good' })
          throw new Error('exploded halfway')
        },
      }
    })
    When('the plugin is loaded', async () => {
      await load(plugin)
    })
    Then('loading fails', () => {
      expect(failure).toBeDefined()
    })
    And('the host does not have a "step-kind" capability "good"', () => {
      expect(host.has('step-kind', 'good')).toBe(false)
    })
    And('the host reports no loaded plugins', () => {
      expect(host.plugins()).toHaveLength(0)
    })
  })

  Scenario('A plugin that contributes nothing is rejected', ({ Given, When, Then, And }) => {
    Given('a plugin "inert" that registers nothing', () => {
      plugin = { name: 'inert', version: '1.0.0', register: () => {} }
    })
    When('the plugin is loaded', async () => {
      await load(plugin)
    })
    Then('loading fails', () => {
      expect(failure).toBeDefined()
    })
    And('the error explains that it cannot affect anything', () => {
      expect(message()).toContain('cannot affect anything')
    })
  })

  Scenario('A capability id that is not a slug is rejected', ({ Given, When, Then, And }) => {
    Given('a plugin "shouty" providing the "step-kind" capability "HTTP"', () => {
      plugin = providing('shouty', 'step-kind', 'HTTP')
    })
    When('the plugin is loaded', async () => {
      await load(plugin)
    })
    Then('loading fails', () => {
      expect(failure).toBeDefined()
    })
    And('the error mentions the invalid id', () => {
      expect(message()).toContain('HTTP')
    })
  })

  Scenario('The same plugin cannot be loaded twice', ({ Given, And, When, Then }) => {
    Given('a plugin "acme-tools" providing the "step-kind" capability "http"', () => {
      plugin = providing('acme-tools', 'step-kind', 'http')
    })
    And('the plugin is loaded', async () => {
      await load(plugin)
    })
    When('the same plugin is loaded again', async () => {
      await load(plugin)
    })
    Then('loading fails', () => {
      expect(failure).toBeDefined()
    })
    And('the error says it is already loaded', () => {
      expect(message()).toContain('already loaded')
    })
  })

  Scenario(
    'Getting a capability without an id returns the only one of its kind',
    ({ Given, When, Then }) => {
      Given('a plugin "acme-desktop" providing the "desktop" capability "shell"', () => {
        plugin = providing('acme-desktop', 'desktop', 'shell')
      })
      When('the plugin is loaded', async () => {
        await load(plugin)
      })
      Then('getting the "desktop" capability returns "shell"', () => {
        expect(host.get('desktop')?.id).toBe('shell')
      })
    },
  )

  Scenario(
    'Getting a capability without an id is ambiguous when there are several',
    ({ Given, When, Then, And }) => {
      Given(
        'a plugin "two-providers" providing the "provider" capabilities "claude" and "codex"',
        () => {
          plugin = providing('two-providers', 'provider', 'claude', 'codex')
        },
      )
      When('the plugin is loaded', async () => {
        await load(plugin)
      })
      Then('getting the "provider" capability returns nothing', () => {
        expect(host.get('provider')).toBeUndefined()
      })
      And('listing "provider" capabilities returns 2 entries', () => {
        expect(host.list('provider')).toHaveLength(2)
      })
    },
  )
})
