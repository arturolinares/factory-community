import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  blockersOf,
  dependencyStatus,
  queueOrder,
  type BlockerFacts,
  type DependencyStatus,
  type QueueOrder,
  type TaskEdge,
} from '../src/task/dependencies.js'
import type { TaskState } from '../src/task/state.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./task-dependencies.feature', import.meta.url)),
)

/** Todolist's real graph, from its own PROJECT.md. */
const TODOLIST: readonly [number, number][] = [
  [2, 1],
  [3, 2],
  [4, 2],
  [5, 4],
  [6, 4],
  [7, 6],
  [8, 6],
  [9, 8],
  [10, 9],
]

describeFeature(feature, ({ Scenario, Rule, BeforeEachScenario }) => {
  let edges: TaskEdge[]
  let facts: Map<string, BlockerFacts>
  let status: DependencyStatus | undefined
  let ordered: QueueOrder | undefined
  let blockers: readonly string[] | undefined

  BeforeEachScenario(() => {
    edges = []
    facts = new Map()
    status = undefined
    ordered = undefined
    blockers = undefined
  })

  const noDependencies = (): void => {
    edges = []
  }
  const dependsOn =
    (taskId: string, blocker: string) =>
    (): void => {
      edges.push({ taskId, dependsOn: blocker })
    }
  const isIn =
    (id: string, state: TaskState) =>
    (): void => {
      facts.set(id, { state })
    }
  const archivedHavingFinished = (id: string) => (): void => {
    facts.set(id, { state: 'archived', completedAt: '2026-09-16T10:00:00.000Z' })
  }
  const archivedUnfinished = (id: string) => (): void => {
    facts.set(id, { state: 'archived' })
  }
  const missing = (id: string) => (): void => {
    facts.delete(id)
  }
  const ask = (id: string) => (): void => {
    status = dependencyStatus(id, edges, (blocker) => facts.get(blocker))
  }
  const order = (...ids: string[]) => (): void => {
    ordered = queueOrder(ids, edges)
  }
  const stateIs = (expected: string) => (): void => {
    expect(status?.state).toBe(expected)
  }
  const orderIs = (expected: string) => (): void => {
    expect((ordered?.order ?? []).join(', ')).toBe(expected)
  }
  const reasonSays = (needle: string) => (): void => {
    expect((status?.dead ?? []).map((entry) => entry.because).join(' ')).toContain(needle)
  }
  const noProblems = (): void => {
    expect(ordered?.problems).toEqual([])
  }

  Scenario('A task with no dependencies is ready', ({ Given, When, Then, And }) => {
    Given('no dependencies at all', noDependencies)
    When('I ask what "task-4" is waiting for', ask('task-4'))
    Then('its dependencies are met', stateIs('met'))
    And('it is waiting for nothing', () => expect(status?.waitingFor).toEqual([]))
  })

  Scenario('A blocker that is done is met', ({ Given, And, When, Then }) => {
    Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
    And('"task-2" is "done"', isIn('task-2', 'done'))
    When('I ask what "task-4" is waiting for', ask('task-4'))
    Then('its dependencies are met', stateIs('met'))
  })

  Scenario('A blocker that has not run is waited for', ({ Given, And, When, Then }) => {
    Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
    And('"task-2" is "draft"', isIn('task-2', 'draft'))
    When('I ask what "task-4" is waiting for', ask('task-4'))
    Then('it is waiting', stateIs('waiting'))
    And('it is waiting for "task-2"', () => expect(status?.waitingFor).toContain('task-2'))
  })

  Scenario('A blocker that is running is waited for', ({ Given, And, When, Then }) => {
    Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
    And('"task-2" is "running"', isIn('task-2', 'running'))
    When('I ask what "task-4" is waiting for', ask('task-4'))
    Then('it is waiting', stateIs('waiting'))
  })

  Scenario('Every blocker has to be done', ({ Given, And, When, Then }) => {
    Given('"task-9" depends on "task-8"', dependsOn('task-9', 'task-8'))
    And('"task-9" depends on "task-7"', dependsOn('task-9', 'task-7'))
    And('"task-8" is "done"', isIn('task-8', 'done'))
    And('"task-7" is "queued"', isIn('task-7', 'queued'))
    When('I ask what "task-9" is waiting for', ask('task-9'))
    Then('it is waiting', stateIs('waiting'))
    And('it is waiting for "task-7"', () => expect(status?.waitingFor).toContain('task-7'))
    And('it is not waiting for "task-8"', () =>
      expect(status?.waitingFor).not.toContain('task-8'),
    )
  })

  Scenario('The same blocker named twice is one blocker', ({ Given, And, When, Then }) => {
    Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
    And('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
    And('"task-2" is "draft"', isIn('task-2', 'draft'))
    When('I ask what "task-4" is waiting for', ask('task-4'))
    Then('it is waiting for exactly 1 task', () => expect(status?.waitingFor).toHaveLength(1))
  })

  Rule('the blockers of a task are read in the order they were given', ({ RuleScenario }) => {
    const which = (id: string) => (): void => {
      blockers = blockersOf(id, edges)
    }
    const blockersAre = (expected: string) => (): void => {
      expect((blockers ?? []).join(', ')).toBe(expected)
    }

    RuleScenario('The blockers come back in edge order', ({ Given, And, When, Then }) => {
      Given('"task-9" depends on "task-8"', dependsOn('task-9', 'task-8'))
      And('"task-9" depends on "task-7"', dependsOn('task-9', 'task-7'))
      When('I ask which tasks block "task-9"', which('task-9'))
      Then('the blockers are "task-8, task-7"', blockersAre('task-8, task-7'))
    })

    RuleScenario('A task nothing blocks has no blockers', ({ Given, When, Then }) => {
      Given('"task-9" depends on "task-8"', dependsOn('task-9', 'task-8'))
      When('I ask which tasks block "task-1"', which('task-1'))
      Then('there are no blockers', () => expect(blockers).toEqual([]))
    })

    RuleScenario('The same blocker twice is listed once', ({ Given, And, When, Then }) => {
      Given('"task-9" depends on "task-8"', dependsOn('task-9', 'task-8'))
      And('"task-9" depends on "task-8"', dependsOn('task-9', 'task-8'))
      When('I ask which tasks block "task-9"', which('task-9'))
      Then('the blockers are "task-8"', blockersAre('task-8'))
    })
  })

  Rule('a blocker that can never finish is dead, not awaited', ({ RuleScenario }) => {
    RuleScenario('A cancelled blocker is dead', ({ Given, And, When, Then }) => {
      Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      And('"task-2" is "cancelled"', isIn('task-2', 'cancelled'))
      When('I ask what "task-4" is waiting for', ask('task-4'))
      Then('its dependencies are dead', stateIs('dead'))
      And('the reason says it was cancelled', reasonSays('cancelled'))
    })

    RuleScenario('A blocked blocker is dead', ({ Given, And, When, Then }) => {
      Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      And('"task-2" is "blocked"', isIn('task-2', 'blocked'))
      When('I ask what "task-4" is waiting for', ask('task-4'))
      Then('its dependencies are dead', stateIs('dead'))
      And('the reason says it is blocked', reasonSays('blocked'))
    })

    RuleScenario('Dead beats waiting', ({ Given, And, When, Then }) => {
      Given('"task-9" depends on "task-8"', dependsOn('task-9', 'task-8'))
      And('"task-9" depends on "task-7"', dependsOn('task-9', 'task-7'))
      And('"task-8" is "running"', isIn('task-8', 'running'))
      And('"task-7" is "cancelled"', isIn('task-7', 'cancelled'))
      When('I ask what "task-9" is waiting for', ask('task-9'))
      Then('its dependencies are dead', stateIs('dead'))
      And('it is waiting for "task-8"', () => expect(status?.waitingFor).toContain('task-8'))
    })

    RuleScenario('A blocker that is not there at all is dead', ({ Given, And, Then }) => {
      Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      And('"task-2" does not exist', () => {
        missing('task-2')()
        ask('task-4')()
      })
      Then('its dependencies are dead', stateIs('dead'))
      And('the reason says it no longer exists', reasonSays('no longer exists'))
    })
  })

  Rule('archiving a finished task does not stall what follows it', ({ RuleScenario }) => {
    RuleScenario('A blocker archived after finishing is met', ({ Given, And, When, Then }) => {
      Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      And('"task-2" is "archived" and had finished', archivedHavingFinished('task-2'))
      When('I ask what "task-4" is waiting for', ask('task-4'))
      Then('its dependencies are met', stateIs('met'))
    })

    RuleScenario('A blocker archived without finishing is dead', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      And('"task-2" is "archived" and never finished', archivedUnfinished('task-2'))
      When('I ask what "task-4" is waiting for', ask('task-4'))
      Then('its dependencies are dead', stateIs('dead'))
      And('the reason says it was archived without finishing', reasonSays('archived without'))
    })
  })

  Rule('the queue order puts blockers first and keeps parallel work parallel', ({
    RuleScenario,
  }) => {
    RuleScenario('A chain is ordered', ({ Given, And, When, Then }) => {
      Given('"task-2" depends on "task-1"', dependsOn('task-2', 'task-1'))
      And('"task-3" depends on "task-2"', dependsOn('task-3', 'task-2'))
      When(
        'I ask for the order of "task-3", "task-1" and "task-2"',
        order('task-3', 'task-1', 'task-2'),
      )
      Then('the order is "task-1, task-2, task-3"', orderIs('task-1, task-2, task-3'))
    })

    RuleScenario('Tasks that do not depend on each other keep the order they were given', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('"task-3" depends on "task-2"', dependsOn('task-3', 'task-2'))
      And('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      When(
        'I ask for the order of "task-4", "task-3" and "task-2"',
        order('task-4', 'task-3', 'task-2'),
      )
      Then('the order is "task-2, task-4, task-3"', orderIs('task-2, task-4, task-3'))
    })

    RuleScenario("Todolist's real graph orders as the project describes it", ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given("todolist's ten tasks and their dependencies", () => {
        edges = TODOLIST.map(([task, blocker]) => ({
          taskId: `task-${task}`,
          dependsOn: `task-${blocker}`,
        }))
      })
      When('I ask for the order of all ten', () => {
        // Given in reverse, so passing cannot be an accident of input order.
        ordered = queueOrder(
          Array.from({ length: 10 }, (_, index) => `task-${10 - index}`),
          edges,
        )
      })
      Then('every task comes after everything it depends on', () => {
        const at = new Map((ordered?.order ?? []).map((id, index) => [id, index]))
        for (const edge of edges) {
          expect(
            at.get(edge.dependsOn),
            `${edge.dependsOn} must come before ${edge.taskId}`,
          ).toBeLessThan(at.get(edge.taskId) as number)
        }
      })
      And('there are no problems', noProblems)
    })

    RuleScenario('A blocker outside the set does not order it', ({ Given, When, Then, And }) => {
      Given('"task-4" depends on "task-2"', dependsOn('task-4', 'task-2'))
      When('I ask for the order of "task-4" alone', order('task-4'))
      Then('the order is "task-4"', orderIs('task-4'))
      And('there are no problems', noProblems)
    })

    RuleScenario('An order with nothing in it is not a problem', ({ Given, When, Then, And }) => {
      Given('no dependencies at all', noDependencies)
      When('I ask for the order of nothing', order())
      Then('the order is empty', () => expect(ordered?.order).toEqual([]))
      And('there are no problems', noProblems)
    })
  })

  Rule('a ring is caught, not followed', ({ RuleScenario }) => {
    const refusedAsRing = (): void => {
      const rings = (ordered?.problems ?? []).filter(
        (problem) => problem.rule === 'dependencies.cycle',
      )
      expect(rings.length).toBeGreaterThan(0)
      expect(rings[0]?.severity).toBe('error')
    }
    const problemNames = (id: string) => (): void => {
      expect((ordered?.problems ?? []).map((problem) => problem.message).join(' ')).toContain(id)
    }

    RuleScenario('A task depending on itself is refused', ({ Given, When, Then, And }) => {
      Given('"task-3" depends on "task-3"', dependsOn('task-3', 'task-3'))
      When('I ask for the order of "task-3"', order('task-3'))
      Then('it is refused as a ring', refusedAsRing)
      And('the problem names "task-3"', problemNames('task-3'))
    })

    RuleScenario('A ring of two is refused, and names both', ({ Given, And, When, Then }) => {
      Given('"task-3" depends on "task-4"', dependsOn('task-3', 'task-4'))
      And('"task-4" depends on "task-3"', dependsOn('task-4', 'task-3'))
      When('I ask for the order of "task-3" and "task-4"', order('task-3', 'task-4'))
      Then('it is refused as a ring', refusedAsRing)
      And('the problem names "task-3"', problemNames('task-3'))
      And('the problem names "task-4"', problemNames('task-4'))
      And('the problem says a task cannot depend on itself however far around', () =>
        expect((ordered?.problems ?? [])[0]?.message).toContain('however far around'),
      )
    })

    RuleScenario('A ring further around is refused', ({ Given, And, When, Then }) => {
      Given('"task-3" depends on "task-4"', dependsOn('task-3', 'task-4'))
      And('"task-4" depends on "task-5"', dependsOn('task-4', 'task-5'))
      And('"task-5" depends on "task-3"', dependsOn('task-5', 'task-3'))
      When(
        'I ask for the order of "task-3", "task-4" and "task-5"',
        order('task-3', 'task-4', 'task-5'),
      )
      Then('it is refused as a ring', refusedAsRing)
    })

    RuleScenario('A ring is reported once, not once per member', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('"task-3" depends on "task-4"', dependsOn('task-3', 'task-4'))
      And('"task-4" depends on "task-3"', dependsOn('task-4', 'task-3'))
      When('I ask for the order of "task-3" and "task-4"', order('task-3', 'task-4'))
      Then('exactly 1 problem is reported', () => expect(ordered?.problems).toHaveLength(1))
    })
  })
})
