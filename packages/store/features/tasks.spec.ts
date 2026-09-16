import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { EventBus } from '@factory/events'
import type { Task } from '@factory/core'
import { MIGRATIONS, RunRepository, TaskRepository, openStore, type Store } from '../src/index.js'

const feature = await loadFeature(fileURLToPath(new URL('./tasks.feature', import.meta.url)))

describeFeature(feature, ({ Background, Rule, Scenario, AfterEachScenario }) => {
  let store: Store
  let tasks: TaskRepository
  let runs: RunRepository
  let task: Task | undefined
  let byName: Map<string, string>
  let failure: unknown
  let tick = 0
  let minted = 0

  AfterEachScenario(() => store?.close())

  // Built in Background, not BeforeEachScenario: the runner executes Background
  // steps first, so anything created there would not exist yet.
  Background(({ Given }) => {
    Given('an empty store', () => {
      tick = 0
      minted = 0
      byName = new Map()
      failure = undefined
      task = undefined
      store = openStore({ file: ':memory:', migrations: MIGRATIONS })
      tasks = new TaskRepository({
        db: store.db,
        events: new EventBus({ onSubscriberError: () => {} }),
        // Monotonic and fake, so ordering assertions are about ordering rather
        // than about how fast the test happened to run.
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
        // Monotonic per call, not per task: entry ids come from here too, and
        // a task with three workflows would otherwise mint the same id three
        // times and collide on (task_id, entry_id).
        newId: () => `id-${(minted += 1)}`,
      })
      runs = new RunRepository({
        db: store.db,
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
        newId: () => `run-${(minted += 1)}`,
      })
    })
  })

  // Returns nothing on purpose: the step callbacks are typed `void`, and a
  // concise arrow that returns the task silently breaks the typecheck.
  const create = (name: string, workflows: string[] = []): void => {
    const created = tasks.create({ name, workflows })
    byName.set(name, created.id)
    task = created
  }
  const idOf = (name: string) => byName.get(name) as string
  const act = (action: Parameters<TaskRepository['act']>[1], reason?: string) => {
    try {
      task = tasks.act(task!.id, action, reason === undefined ? {} : { reason })
    } catch (error) {
      failure = error
    }
  }
  const offered = () => tasks.actions(task!.id).map((entry) => entry.action).sort().join(', ')

  Scenario('A new task starts as a draft', ({ When, Then, And }) => {
    When('I create a task "Add due dates"', () => create('Add due dates'))
    Then('the task is "draft"', () => expect(task?.state).toBe('draft'))
    And('its history is empty', () => expect(tasks.history(task!.id)).toHaveLength(0))
  })

  Scenario('A draft with no workflows cannot be queued', ({ When, Then }) => {
    When('I create a task "Add due dates"', () => create('Add due dates'))
    // Queueing something with nothing to run would put it in front of the
    // scheduler only to be rejected there.
    Then('"queue" is not offered', () => expect(offered()).not.toContain('queue'))
  })

  Scenario('Assigning a workflow makes it queueable', ({ Given, When, Then }) => {
    Given('a task "Add due dates"', () => create('Add due dates'))
    When('I assign the workflow "development"', () => {
      task = tasks.assign(task!.id, ['development'])
    })
    Then('"queue" is offered', () => expect(offered()).toContain('queue'))
  })

  Scenario('Queueing puts it in line', ({ Given, When, Then, And }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    When('I queue it', () => act('queue'))
    Then('the task is "queued"', () => expect(task?.state).toBe('queued'))
    And('it has a place in the queue', () => expect(task?.queuePosition).toBeGreaterThan(0))
  })

  Scenario('Tasks queue behind each other', ({ Given, And, When, Then }) => {
    Given('a task "First" with the workflow "development"', () => create('First', ['development']))
    And('a task "Second" with the workflow "development"', () => create('Second', ['development']))
    When('I queue "First"', () => {
      task = tasks.act(idOf('First'), 'queue')
    })
    And('I queue "Second"', () => {
      task = tasks.act(idOf('Second'), 'queue')
    })
    Then('"Second" is behind "First" in the queue', () => {
      const first = tasks.get(idOf('First'))!
      const second = tasks.get(idOf('Second'))!
      expect(second.queuePosition!).toBeGreaterThan(first.queuePosition!)
    })
  })

  Scenario('Every transition is recorded', ({ Given, When, Then, And }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    When('I queue it', () => act('queue'))
    Then('its history has 1 entry', () => expect(tasks.history(task!.id)).toHaveLength(1))
    And('the entry says it went from "draft" to "queued"', () => {
      const [entry] = tasks.history(task!.id)
      expect(entry?.from).toBe('draft')
      expect(entry?.to).toBe('queued')
    })
  })

  const givenRunning = () => {
    create('Add due dates', ['development'])
    act('queue')
    act('start')
  }

  Scenario('A blocked task records why', ({ Given, When, Then, And }) => {
    Given('a running task', givenRunning)
    When('it is blocked because "the tests failed"', () => act('block', 'the tests failed'))
    Then('the task is "blocked"', () => expect(task?.state).toBe('blocked'))
    And('the reason is "the tests failed"', () =>
      expect(task?.blockedReason).toBe('the tests failed'),
    )
  })

  Scenario('Retrying clears the reason', ({ Given, And, When, Then }) => {
    Given('a running task', givenRunning)
    And('it is blocked because "the tests failed"', () => act('block', 'the tests failed'))
    When('I retry it', () => act('retry'))
    Then('the task is "queued"', () => expect(task?.state).toBe('queued'))
    And('there is no reason recorded', () => expect(task?.blockedReason).toBeUndefined())
  })

  Scenario('A finished task can be run again', ({ Given, When, Then, And }) => {
    Given('a running task', givenRunning)
    When('it completes', () => act('complete'))
    Then('the task is "done"', () => expect(task?.state).toBe('done'))
    And('it has a completion time', () => expect(task?.completedAt).toBeDefined())
    When('I queue it again', () => act('queue'))
    Then('the task is "queued"', () => expect(task?.state).toBe('queued'))
    // A task claiming to be both done and queued is the kind of contradiction
    // that makes a board impossible to read.
    And('it no longer has a completion time', () => expect(task?.completedAt).toBeUndefined())
  })

  Scenario('An action the state does not allow is refused', ({ Given, When, Then, And }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    When('I try to approve it', () => act('approve'))
    Then('it is refused', () => expect(failure).toBeDefined())
    And('the error says what is available instead', () =>
      expect((failure as Error).message).toContain('Available:'),
    )
  })

  Scenario('The available actions depend on the state', ({ Given, Then, When }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    Then('the offered actions are "archive, cancel, queue"', () =>
      expect(offered()).toBe('archive, cancel, queue'),
    )
    When('I queue it', () => act('queue'))
    Then('the offered actions are "cancel"', () => expect(offered()).toBe('cancel'))
  })

  Scenario('Internal actions are not offered to a person', ({ Given, When, Then }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    When('I queue it', () => act('queue'))
    // `start` belongs to the scheduler. Offering it would invite someone to
    // bypass the concurrency cap by hand.
    Then('"start" is not offered', () => expect(offered()).not.toContain('start'))
  })

  const givenAwaiting = () => {
    givenRunning()
    // Through the real door: the engine asks for this when a phase needs a
    // person, so the fixture must too.
    act('await_approval')
  }

  Scenario('A task awaiting approval can be approved or rejected', ({ Given, Then }) => {
    Given('a task awaiting approval', givenAwaiting)
    Then('the offered actions are "approve, cancel, reject"', () =>
      expect(offered()).toBe('approve, cancel, reject'),
    )
  })

  Scenario('Approving resumes it', ({ Given, When, Then }) => {
    Given('a task awaiting approval', givenAwaiting)
    When('I approve it', () => act('approve'))
    Then('the task is "running"', () => expect(task?.state).toBe('running'))
  })

  Scenario('Rejecting blocks it', ({ Given, When, Then }) => {
    Given('a task awaiting approval', givenAwaiting)
    When('I reject it', () => act('reject'))
    Then('the task is "blocked"', () => expect(task?.state).toBe('blocked'))
  })

  Scenario('Archiving hides it from the board', ({ Given, When, Then, And }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    When('I archive it', () => act('archive'))
    Then('the task is "archived"', () => expect(task?.state).toBe('archived'))
    And('it is not in the default listing', () => expect(tasks.list()).toHaveLength(0))
    And('it is in the listing that includes archived tasks', () =>
      expect(tasks.list({ includeArchived: true })).toHaveLength(1),
    )
  })

  Scenario('A restored task comes back as a draft', ({ Given, And, When, Then }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    And('it is archived', () => act('archive'))
    When('I restore it', () => act('restore'))
    Then('the task is "draft"', () => expect(task?.state).toBe('draft'))
  })

  Scenario('Cancelling is possible from anywhere that is still live', ({ Given, When, Then }) => {
    Given('a running task', givenRunning)
    When('I cancel it', () => act('cancel'))
    Then('the task is "cancelled"', () => expect(task?.state).toBe('cancelled'))
  })

  Scenario('A transition and its history are written together', ({ Given, When, Then }) => {
    Given('a task "Add due dates" with the workflow "development"', () =>
      create('Add due dates', ['development']),
    )
    When('a transition fails partway', () => {
      // The history insert is forced to fail, which must take the state change
      // with it: a recorded transition that did not happen, or a transition
      // with no record, are both worse than the write simply failing.
      store.db.exec('DROP TABLE task_history')
      act('queue')
    })
    Then('no history was recorded', () => {
      expect(failure).toBeDefined()
      expect(tasks.get(task!.id)?.state).toBe('draft')
    })
  })

  Rule('Editing the list keeps what each entry already knows', ({ RuleScenario }) => {
    /**
     * Two of three finished.
     *
     * "Has run" is derived from the runs rather than stored, so the fixture has
     * to produce real ones — which is the point: nothing can claim an entry ran
     * without a run to show for it.
     */
    const twoDone = (): void => {
      create('Add due dates', ['one', 'two', 'three'])
      for (const entry of task!.workflows.slice(0, 2)) {
        const run = runs.start({ workflow: entry.workflow, taskId: task!.id, entryId: entry.id })
        runs.finish(run.id, 'completed')
        task = tasks.finished(task!.id, entry.id)
      }
      task = tasks.get(task!.id)
    }
    const names = () => task!.workflows.map((entry) => entry.workflow)
    const ticked = (name: string) =>
      task!.workflows.find((entry) => entry.workflow === name)?.enabled
    const assign = (selection: Parameters<typeof tasks.assign>[1]): void => {
      try {
        task = tasks.assign(task!.id, selection)
      } catch (error) {
        failure = error
      }
    }
    const entriesExcept = (name: string) =>
      task!.workflows.filter((entry) => entry.workflow !== name).map((entry) => ({ ...entry }))

    const givenTwoDone = 'a task with "one", "two" and "three", of which "one" and "two" have run'

    RuleScenario("Reordering keeps every entry's tick", ({ Given, When, Then, And }) => {
      Given(givenTwoDone, twoDone)
      When('I put the same workflows in a different order', () =>
        assign([...task!.workflows].reverse().map((entry) => ({ ...entry }))),
      )
      // The edit that used to cost you every finished workflow.
      Then('"one" and "two" are still unticked', () => {
        expect(ticked('one')).toBe(false)
        expect(ticked('two')).toBe(false)
      })
      And('"three" is still ticked', () => expect(ticked('three')).toBe(true))
    })

    RuleScenario('Adding a workflow leaves the others alone', ({ Given, When, Then, And }) => {
      Given(givenTwoDone, twoDone)
      When('I add "four" to the end', () =>
        assign([...task!.workflows.map((entry) => ({ ...entry })), 'four']),
      )
      Then('"one" and "two" are still unticked', () => {
        expect(ticked('one')).toBe(false)
        expect(ticked('two')).toBe(false)
      })
      And('"four" is ticked', () => expect(ticked('four')).toBe(true))
    })

    RuleScenario('Saving an unedited list changes nothing', ({ Given, When, Then }) => {
      Given(givenTwoDone, twoDone)
      When('I assign the same list of workflows', () =>
        assign(task!.workflows.map((entry) => ({ ...entry }))),
      )
      Then('"one" and "two" are still unticked', () => {
        expect(ticked('one')).toBe(false)
        expect(ticked('two')).toBe(false)
      })
    })

    RuleScenario('A workflow that has never run can be taken off', ({ Given, When, Then }) => {
      Given(givenTwoDone, twoDone)
      When('I take "three" off the list', () => assign(entriesExcept('three')))
      Then('the list is "one, two"', () => expect(names()).toEqual(['one', 'two']))
    })

    RuleScenario('A workflow that has run cannot be taken off', ({ Given, When, Then, And }) => {
      Given(givenTwoDone, twoDone)
      When('I take "two" off the list', () => assign(entriesExcept('two')))
      Then('the change is refused', () => expect(failure).toBeInstanceOf(Error))
      And('the refusal names "two"', () => expect(String(failure)).toContain('two'))
    })

    // All or nothing: the refusal is raised before anything is written.
    RuleScenario('Nothing is half-applied when a removal is refused', ({ Given, When, Then }) => {
      Given(givenTwoDone, twoDone)
      When('I take "two" off the list', () => assign(entriesExcept('two')))
      Then('the list is still "one, two, three"', () => {
        expect(tasks.get(task!.id)?.workflows.map((entry) => entry.workflow)).toEqual([
          'one',
          'two',
          'three',
        ])
      })
    })
  })

  Rule('A workflow is ticked until the engine has finished with it', ({ RuleScenario }) => {
    const ticked = (name: string) =>
      task!.workflows.find((entry) => entry.workflow === name)?.enabled
    const canQueue = () =>
      tasks.actions(task!.id).some((available) => available.action === 'queue')

    RuleScenario('A new task has everything ticked', ({ Given, Then }) => {
      Given('a task "Add due dates" with the workflow "development"', () =>
        create('Add due dates', ['development']),
      )
      Then('"development" is ticked', () => expect(ticked('development')).toBe(true))
    })

    const allOff = (): void => {
      create('Add due dates', ['one', 'two', 'three'])
      task = tasks.assign(
        task!.id,
        task!.workflows.map((entry) => ({ ...entry, enabled: false })),
      )
    }

    RuleScenario('A task with nothing ticked cannot be queued', ({ Given, And, Then }) => {
      Given('a task with "one", "two" and "three", of which "one" and "two" have run', allOff)
      And('"three" is unticked as well', () => undefined)
      // One click should never set five agents on a repository because
      // everything happened to be finished.
      Then('it cannot be queued', () => expect(canQueue()).toBe(false))
    })

    RuleScenario('Ticking one back on makes it queueable again', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a task with "one", "two" and "three", of which "one" and "two" have run', allOff)
      And('"three" is unticked as well', () => undefined)
      When('I tick "one" back on', () => {
        task = tasks.assign(
          task!.id,
          task!.workflows.map((entry) =>
            entry.workflow === 'one' ? { ...entry, enabled: true } : { ...entry },
          ),
        )
      })
      Then('it can be queued', () => expect(canQueue()).toBe(true))
    })
  })

  Rule('A task can be renamed without losing where its work lives', ({ RuleScenario }) => {
    let directoryBefore = ''

    const givenTask = (): void => {
      create('Add due dates', ['development'])
      directoryBefore = task?.directory ?? ''
    }
    const renameTo = (name: string): void => {
      try {
        task = tasks.rename(task!.id, name)
      } catch (error) {
        failure = error
      }
    }

    RuleScenario('Renaming changes the name', ({ Given, When, Then }) => {
      Given('a task "Add due dates" with the workflow "development"', givenTask)
      When('I rename it to "Add due dates and times"', () => renameTo('Add due dates and times'))
      Then('the task is called "Add due dates and times"', () =>
        expect(task?.name).toBe('Add due dates and times'),
      )
    })

    RuleScenario('Renaming leaves the directory alone', ({ Given, When, Then }) => {
      Given('a task "Add due dates" with the workflow "development"', givenTask)
      When('I rename it to "Something else entirely"', () => renameTo('Something else entirely'))
      // Otherwise the worktree it is working in becomes unreachable, and a
      // later step runs in the repository instead without saying so.
      Then('its directory is unchanged', () => {
        expect(task?.directory).toBe(directoryBefore)
        expect(directoryBefore).not.toBe('')
      })
    })

    RuleScenario('A task cannot be renamed to nothing', ({ Given, When, Then }) => {
      Given('a task "Add due dates" with the workflow "development"', givenTask)
      When('I rename it to "   "', () => renameTo('   '))
      Then('the rename is refused', () => expect(failure).toBeInstanceOf(Error))
    })
  })

  Rule('A task says what it is for, separately from what it is called', ({ RuleScenario }) => {
    let directoryBefore = ''

    const givenTask = (): void => {
      create('Add due dates', ['development'])
      directoryBefore = task?.directory ?? ''
    }
    const givenDescribed = (description: string): void => {
      givenTask()
      task = tasks.describe(task!.id, description)
    }
    const describeAs = (description: string): void => {
      task = tasks.describe(task!.id, description)
    }

    RuleScenario('A task with no description has an empty one, not a missing one', ({
      Given,
      Then,
    }) => {
      Given('a task "Add due dates" with the workflow "development"', givenTask)
      // '' rather than undefined, so `{{ task.description }}` resolves to
      // nothing instead of warning about a key the dictionary documents.
      Then('its description is empty', () => expect(task?.description).toBe(''))
    })

    RuleScenario('Describing a task', ({ Given, When, Then }) => {
      Given('a task "Add due dates" with the workflow "development"', givenTask)
      When('I describe it as "Every todo gets an optional due date, shown on the list."', () =>
        describeAs('Every todo gets an optional due date, shown on the list.'),
      )
      Then('its description is "Every todo gets an optional due date, shown on the list."', () =>
        expect(task?.description).toBe('Every todo gets an optional due date, shown on the list.'),
      )
    })

    RuleScenario('A description can be cleared', ({ Given, When, Then }) => {
      Given('a task "Add due dates" described as "Something provisional"', () =>
        givenDescribed('Something provisional'),
      )
      When('I describe it as ""', () => describeAs(''))
      Then('its description is empty', () => expect(task?.description).toBe(''))
    })

    RuleScenario('Renaming leaves the description alone', ({ Given, When, Then }) => {
      Given('a task "Add due dates" described as "Every todo gets an optional due date."', () =>
        givenDescribed('Every todo gets an optional due date.'),
      )
      When('I rename it to "Something else entirely"', () => {
        task = tasks.rename(task!.id, 'Something else entirely')
      })
      Then('its description is "Every todo gets an optional due date."', () =>
        expect(task?.description).toBe('Every todo gets an optional due date.'),
      )
    })

    RuleScenario('Describing leaves the name and the directory alone', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('a task "Add due dates" with the workflow "development"', givenTask)
      When('I describe it as "A brief."', () => describeAs('A brief.'))
      Then('the task is called "Add due dates"', () => expect(task?.name).toBe('Add due dates'))
      And('its directory is unchanged', () => {
        expect(task?.directory).toBe(directoryBefore)
        expect(directoryBefore).not.toBe('')
      })
    })
  })

  Rule('A task remembers the agent session its steps share', ({ RuleScenario }) => {
    const given = () => {
      task = tasks.create({ name: 'Add due dates' })
    }
    const record = (id: string) => () => {
      task = tasks.rememberSession((task as Task).id, { id, provider: 'claude' })
    }
    const carries = (id: string) => () => expect(task?.session?.id).toBe(id)

    RuleScenario('A new task has no session', ({ Given, Then }) => {
      Given('the task "Add due dates" exists', given)
      Then('it carries no session', () => expect(task?.session).toBeUndefined())
    })

    RuleScenario('A session is written down and read back', ({ Given, When, Then, And }) => {
      Given('the task "Add due dates" exists', given)
      When('the session "s-1" for "claude" is recorded', record('s-1'))
      Then('it carries the session "s-1"', carries('s-1'))
      And('the session belongs to "claude"', () =>
        expect(task?.session?.provider).toBe('claude'),
      )
    })

    RuleScenario('The first one recorded is the one it keeps', ({ Given, And, When, Then }) => {
      Given('the task "Add due dates" exists', given)
      And('the session "s-1" for "claude" is recorded', record('s-1'))
      When('the session "s-2" for "claude" is recorded', record('s-2'))
      Then('it carries the session "s-1"', carries('s-1'))
    })

    RuleScenario('A session for a task that is not there is an error', ({ When, Then }) => {
      When('the session "s-1" is recorded for a task that does not exist', () => {
        try {
          tasks.rememberSession('nope', { id: 's-1', provider: 'claude' })
        } catch (error) {
          failure = error
        }
      })
      Then('it fails', () => expect(failure).toBeInstanceOf(Error))
    })
  })

  Rule('A task\'s directory is a single path segment, whoever chose it', ({ RuleScenario }) => {
    const created = (name: string, directory?: string) => (): void => {
      task = tasks.create({ name, ...(directory === undefined ? {} : { directory }) })
    }
    const directoryIs = (expected: string) => (): void => {
      expect(task?.directory).toBe(expected)
    }
    const noSeparator = (): void => {
      expect(task?.directory).not.toContain('/')
      expect(task?.directory).not.toContain('\\')
      expect(task?.directory).not.toContain('..')
    }

    RuleScenario('A directory derived from the name is slugged', ({ When, Then }) => {
      When('a task called "Add due dates" is created', created('Add due dates'))
      Then('its directory is "add-due-dates"', directoryIs('add-due-dates'))
    })

    RuleScenario('A supplied directory is slugged too', ({ When, Then }) => {
      When(
        'a task is created asking for the directory "Add Due Dates"',
        created('Add due dates', 'Add Due Dates'),
      )
      Then('its directory is "add-due-dates"', directoryIs('add-due-dates'))
    })

    RuleScenario('A supplied directory cannot climb out', ({ When, Then, And }) => {
      When(
        'a task is created asking for the directory "../../escape"',
        created('Add due dates', '../../escape'),
      )
      Then('its directory is "escape"', directoryIs('escape'))
      And('its directory contains no separator', noSeparator)
    })

    RuleScenario('An absolute supplied directory cannot restart the path', ({
      When,
      Then,
      And,
    }) => {
      When(
        'a task is created asking for the directory "/etc/passwd"',
        created('Add due dates', '/etc/passwd'),
      )
      Then('its directory is "etc-passwd"', directoryIs('etc-passwd'))
      And('its directory contains no separator', noSeparator)
    })

    RuleScenario('A supplied directory that slugs away still gets a name', ({ When, Then }) => {
      When(
        'a task is created asking for the directory "../.."',
        created('Add due dates', '../..'),
      )
      Then('its directory is "task"', directoryIs('task'))
    })

    RuleScenario('Two tasks never share a directory, even when both ask for one', ({
      Given,
      When,
      Then,
    }) => {
      Given(
        'a task is created asking for the directory "shared"',
        created('First task', 'shared'),
      )
      When(
        'a task is created asking for the directory "shared"',
        created('Second task', 'shared'),
      )
      Then('its directory is "shared-2"', directoryIs('shared-2'))
    })
  })
})
