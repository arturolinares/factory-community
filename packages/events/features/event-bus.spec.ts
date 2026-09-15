import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { EventBus, type FactoryEvent } from '../src/index.js'

const feature = await loadFeature(fileURLToPath(new URL('./event-bus.feature', import.meta.url)))

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let bus: EventBus
  let received: FactoryEvent[]
  let lateReceived: FactoryEvent[]
  let reportedErrors: unknown[]
  let unsubscribe: () => void
  let publishThrew: unknown

  // A fixed clock so "carries a timestamp" is an assertion, not a coin flip.
  const at = new Date('2026-01-01T00:00:00.000Z')

  const publish = (name: 'definition.created' | 'definition.deleted', workflow: string) => {
    try {
      bus.emit(name, {
        kind: 'workflow',
        name: workflow,
        scope: 'project',
        path: `/tmp/.factory/workflows/${workflow}.workflow.yaml`,
        ...(name === 'definition.deleted' ? { nowResolvesFrom: null } : {}),
      } as never)
    } catch (error) {
      publishThrew = error
    }
  }

  /**
   * The workflow name out of whichever event this is.
   *
   * A collected event is the whole union, and not every payload carries a
   * name — so reading one has to narrow rather than assume the scenario knows
   * which event it published.
   */
  const namedWorkflow = (event: FactoryEvent | undefined): string | undefined =>
    event !== undefined && 'name' in event.payload ? event.payload.name : undefined

  BeforeEachScenario(() => {
    received = []
    lateReceived = []
    reportedErrors = []
    publishThrew = undefined
    unsubscribe = () => {}
    bus = new EventBus({
      now: () => at,
      onSubscriberError: (error) => reportedErrors.push(error),
    })
  })

  Scenario('A subscriber receives the event it asked for', ({ Given, When, Then, And }) => {
    Given('a subscriber to "definition.created"', () => {
      unsubscribe = bus.on('definition.created', (event) => received.push(event))
    })
    When('"definition.created" is published for the workflow "development"', () => {
      publish('definition.created', 'development')
    })
    Then('the subscriber received 1 event', () => {
      expect(received).toHaveLength(1)
    })
    And('the received event names the workflow "development"', () => {
      expect(namedWorkflow(received[0])).toBe('development')
    })
    And('the received event carries a timestamp', () => {
      expect(received[0]?.at).toBe('2026-01-01T00:00:00.000Z')
    })
  })

  Scenario('A subscriber is not told about other events', ({ Given, When, Then }) => {
    Given('a subscriber to "definition.created"', () => {
      bus.on('definition.created', (event) => received.push(event))
    })
    When('"definition.deleted" is published for the workflow "development"', () => {
      publish('definition.deleted', 'development')
    })
    Then('the subscriber received 0 events', () => {
      expect(received).toHaveLength(0)
    })
  })

  Scenario('A wildcard subscriber receives every event', ({ Given, When, Then, And }) => {
    Given('a subscriber to every event', () => {
      bus.onAny((event) => received.push(event))
    })
    When('"definition.created" is published for the workflow "development"', () => {
      publish('definition.created', 'development')
    })
    And('"definition.deleted" is published for the workflow "release"', () => {
      publish('definition.deleted', 'release')
    })
    Then('the subscriber received 2 events', () => {
      expect(received).toHaveLength(2)
    })
  })

  Scenario('Unsubscribing stops delivery', ({ Given, When, Then, And }) => {
    Given('a subscriber to "definition.created"', () => {
      unsubscribe = bus.on('definition.created', (event) => received.push(event))
    })
    When('the subscriber unsubscribes', () => {
      unsubscribe()
    })
    And('"definition.created" is published for the workflow "development"', () => {
      publish('definition.created', 'development')
    })
    Then('the subscriber received 0 events', () => {
      expect(received).toHaveLength(0)
    })
  })

  Scenario('A one-shot subscriber is delivered exactly once', ({ Given, When, Then, And }) => {
    Given('a one-shot subscriber to "definition.created"', () => {
      bus.once('definition.created', (event) => received.push(event))
    })
    When('"definition.created" is published for the workflow "development"', () => {
      publish('definition.created', 'development')
    })
    And('"definition.created" is published for the workflow "release"', () => {
      publish('definition.created', 'release')
    })
    Then('the subscriber received 1 event', () => {
      expect(received).toHaveLength(1)
    })
    And('the received event names the workflow "development"', () => {
      expect(namedWorkflow(received[0])).toBe('development')
    })
  })

  Scenario('A subscriber that throws does not break the publisher', ({ Given, And, When, Then }) => {
    Given('a subscriber to "definition.created" that throws', () => {
      bus.on('definition.created', () => {
        throw new Error('plugin is broken')
      })
    })
    And('a subscriber to "definition.created"', () => {
      bus.on('definition.created', (event) => received.push(event))
    })
    When('"definition.created" is published for the workflow "development"', () => {
      publish('definition.created', 'development')
    })
    Then('publishing did not throw', () => {
      expect(publishThrew).toBeUndefined()
    })
    And('the error was reported once', () => {
      expect(reportedErrors).toHaveLength(1)
    })
    And('the subscriber received 1 event', () => {
      expect(received).toHaveLength(1)
    })
  })

  Scenario(
    'A subscriber added while an event is being delivered does not receive it',
    ({ Given, When, Then }) => {
      Given('a subscriber to "definition.created" that subscribes another on delivery', () => {
        bus.on('definition.created', () => {
          bus.on('definition.created', (event) => lateReceived.push(event))
        })
      })
      When('"definition.created" is published for the workflow "development"', () => {
        publish('definition.created', 'development')
      })
      Then('the late subscriber received 0 events', () => {
        expect(lateReceived).toHaveLength(0)
      })
    },
  )
})
