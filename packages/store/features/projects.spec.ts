import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventBus, type FactoryEvent } from '@factory/events'
import type { Project, Task } from '@factory/core'
import {
  MIGRATIONS,
  ProjectRepository,
  TaskRepository,
  openStore,
  type Store,
} from '../src/index.js'

const feature = await loadFeature(fileURLToPath(new URL('./projects.feature', import.meta.url)))

describeFeature(feature, ({ Background, Scenario, AfterEachScenario }) => {
  let store: Store
  let projects: ProjectRepository
  let tasks: TaskRepository
  let root = ''
  let repo = ''
  let project: Project | undefined
  let task: Task | undefined
  let listed: Project[] = []
  let failure: unknown
  let events: FactoryEvent[] = []
  let plain = ''
  let tick = 0

  AfterEachScenario(() => {
    store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  // Built in Background: Background steps run first, before anything in
  // BeforeEachScenario would exist.
  Background(({ Given, And }) => {
    Given('an empty store', () => {
      tick = 0
      failure = undefined
      project = undefined
      task = undefined
      listed = []
      events = []
      plain = ''
      root = mkdtempSync(join(tmpdir(), 'factory-projects-'))
      store = openStore({ file: ':memory:', migrations: MIGRATIONS })
      let ids = 0
      const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
      const bus = new EventBus({ onSubscriberError: () => {} })
      bus.onAny((event) => events.push(event))
      projects = new ProjectRepository({
        db: store.db,
        events: bus,
        now,
        newId: () => `project-${++ids}`,
      })
      tasks = new TaskRepository({ db: store.db, now, newId: () => `task-${++ids}` })
    })
    And('a directory that is a git repository', () => {
      repo = join(root, 'factory')
      mkdirSync(join(repo, '.git'), { recursive: true })
    })
  })

  const attempt = (work: () => void): void => {
    try {
      work()
    } catch (error) {
      failure = error
    }
  }
  const add = (name: string, path = repo): void => {
    attempt(() => {
      project = projects.add({ name, path })
    })
  }

  Scenario('Adding a project', ({ When, Then, And }) => {
    When('I add the project "factory" at that directory', () => add('factory'))
    Then('the project is stored', () => expect(projects.list()).toHaveLength(1))
    And('the project\'s branch is "main"', () => expect(project?.defaultBranch).toBe('main'))
    // Never inside the repository: a worktree under the working copy shows up
    // as untracked and removing one can touch tracked files.
    And('the project has somewhere to put worktrees', () => {
      expect(project?.worktreesRoot).toBeDefined()
      expect(project?.worktreesRoot.startsWith(`${repo}/`)).toBe(false)
    })
  })

  Scenario('A project needs a directory that exists', ({ When, Then, And }) => {
    When('I add the project "ghost" at a path that does not exist', () =>
      add('ghost', join(root, 'nowhere')),
    )
    Then('it is refused', () => expect(failure).toBeDefined())
    And('the error names the path', () =>
      expect((failure as Error).message).toContain('nowhere'),
    )
  })

  Scenario('A project needs a directory, not a file', ({ When, Then }) => {
    When('I add the project "afile" at a file', () => {
      const file = join(root, 'notes.md')
      writeFileSync(file, 'hello')
      add('afile', file)
    })
    Then('it is refused', () => expect(failure).toBeDefined())
  })

  Scenario('A directory that is not a repository is allowed, and said so', ({
    Given,
    When,
    Then,
    And,
  }) => {
    let plain = ''
    Given('a directory that is not a git repository', () => {
      plain = join(root, 'notes')
      mkdirSync(plain, { recursive: true })
    })
    When('I add the project "notes" at that directory', () => add('notes', plain))
    Then('the project is stored', () => expect(projects.list()).toHaveLength(1))
    And('the project is marked as not being a repository', () =>
      expect(project?.isRepository).toBe(false),
    )
  })

  Scenario('Names are unique', ({ Given, When, Then, And }) => {
    Given('the project "factory" exists', () => add('factory'))
    When('I add the project "factory" at that directory again', () => add('factory'))
    Then('it is refused', () => expect(failure).toBeDefined())
    And('the error says the name is taken', () =>
      expect((failure as Error).message).toContain('already a project'),
    )
  })

  Scenario('A task can belong to a project', ({ Given, When, Then }) => {
    Given('the project "factory" exists', () => add('factory'))
    When('I create a task "Add due dates" in "factory"', () => {
      task = tasks.create({ name: 'Add due dates', projectId: project?.id as string })
    })
    Then('the task belongs to "factory"', () => expect(task?.projectId).toBe(project?.id))
  })

  Scenario('A task need not belong to one', ({ When, Then }) => {
    When('I create a task "Add due dates" with no project', () => {
      task = tasks.create({ name: 'Add due dates' })
    })
    Then('the task belongs to no project', () => expect(task?.projectId).toBeUndefined())
  })

  Scenario('Removing a project leaves its tasks without one', ({ Given, And, When, Then }) => {
    Given('the project "factory" exists', () => add('factory'))
    And('a task "Add due dates" in "factory"', () => {
      task = tasks.create({ name: 'Add due dates', projectId: project?.id as string })
    })
    When('I remove the project', () => {
      projects.remove(project?.id as string)
    })
    Then('the task still exists', () => expect(tasks.get(task?.id as string)).toBeDefined())
    And('the task belongs to no project', () =>
      expect(tasks.get(task?.id as string)?.projectId).toBeUndefined(),
    )
  })

  Scenario('Projects are listed by name', ({ Given, And, When, Then }) => {
    Given('the project "zebra" exists', () => {
      mkdirSync(join(root, 'zebra'), { recursive: true })
      add('zebra', join(root, 'zebra'))
    })
    And('the project "alpha" exists', () => {
      mkdirSync(join(root, 'alpha'), { recursive: true })
      add('alpha', join(root, 'alpha'))
    })
    When('I list the projects', () => {
      listed = projects.list()
    })
    Then('they are "alpha, zebra" in that order', () =>
      expect(listed.map((entry) => entry.name)).toEqual(['alpha', 'zebra']),
    )
  })

  const addWith = (name: string, path: string, usesWorktrees: boolean): void => {
    attempt(() => {
      project = projects.add({ name, path, usesWorktrees })
    })
  }
  const givenPlainDirectory = (): void => {
    plain = join(root, 'notes')
    mkdirSync(plain, { recursive: true })
  }
  const setWorktrees = (on: boolean): void => {
    attempt(() => {
      project = projects.setWorktrees(project?.id as string, on)
    })
  }

  Scenario('A project gives each task its own worktree unless it says otherwise', ({
    When,
    Then,
  }) => {
    When('I add the project "factory" at that directory', () => add('factory'))
    Then('the project uses worktrees', () => expect(project?.usesWorktrees).toBe(true))
  })

  Scenario('A project can be added to work in its own checkout instead', ({ When, Then, And }) => {
    When('I add the project "factory" at that directory, working in place', () =>
      addWith('factory', repo, false),
    )
    Then('the project does not use worktrees', () => expect(project?.usesWorktrees).toBe(false))
    // Turning the setting back on must not have lost where they went.
    And('the project still remembers where worktrees would go', () =>
      expect(project?.worktreesRoot ?? '').not.toBe(''),
    )
  })

  Scenario('A directory that is not a repository works in place from the start', ({
    Given,
    When,
    Then,
  }) => {
    Given('a directory that is not a git repository', givenPlainDirectory)
    When('I add the project "notes" at that directory', () => add('notes', plain))
    // A worktree there is impossible, not merely unwanted.
    Then('the project does not use worktrees', () => expect(project?.usesWorktrees).toBe(false))
  })

  Scenario('Asking for worktrees where there is no repository is refused', ({
    Given,
    When,
    Then,
    And,
  }) => {
    Given('a directory that is not a git repository', givenPlainDirectory)
    When('I add the project "notes" at that directory, using worktrees', () =>
      addWith('notes', plain, true),
    )
    Then('it is refused', () => expect(failure).toBeDefined())
    And('the error says it is not a git repository', () =>
      expect((failure as Error).message).toContain('not a git repository'),
    )
  })

  Scenario('Worktrees can be turned off after the project was added', ({ Given, When, Then }) => {
    Given('the project "factory" exists', () => add('factory'))
    When('I turn its worktrees off', () => setWorktrees(false))
    Then('the project does not use worktrees', () => expect(project?.usesWorktrees).toBe(false))
  })

  Scenario('Turning worktrees back on needs a repository', ({ Given, And, When, Then }) => {
    Given('a directory that is not a git repository', givenPlainDirectory)
    And('the project "notes" exists there', () => add('notes', plain))
    When('I turn its worktrees on', () => setWorktrees(true))
    Then('it is refused', () => expect(failure).toBeDefined())
  })

  Scenario('Turning worktrees on notices a directory that has since become one', ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('a directory that is not a git repository', givenPlainDirectory)
    And('the project "notes" exists there', () => add('notes', plain))
    // `is_repository` is written once when the project is added and never
    // refreshed, so trusting it would strand anyone who ran `git init` later.
    And('the directory becomes a git repository', () => {
      mkdirSync(join(plain, '.git'), { recursive: true })
    })
    When('I turn its worktrees on', () => setWorktrees(true))
    Then('the project uses worktrees', () => expect(project?.usesWorktrees).toBe(true))
    And('the project is no longer marked as not being a repository', () =>
      expect(project?.isRepository).toBe(true),
    )
  })

  Scenario('Changing the setting is announced', ({ Given, When, Then }) => {
    Given('the project "factory" exists', () => add('factory'))
    When('I turn its worktrees off', () => setWorktrees(false))
    Then('a "project.changed" event says so', () => {
      const changed = events.find((event) => event.name === 'project.changed')
      expect(changed?.payload).toMatchObject({ name: 'factory', usesWorktrees: false })
    })
  })

  Scenario('Changing a project that is not there is refused', ({ When, Then }) => {
    When('I turn worktrees off on a project that does not exist', () =>
      attempt(() => projects.setWorktrees('nope', false)),
    )
    Then('it is refused', () => expect(failure).toBeDefined())
  })
})
