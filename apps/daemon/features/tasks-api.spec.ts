import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { createRuntime, type Runtime } from '@factory/runtime'
import {
  TERMINAL_KIND,
  terminalCommand,
  type PluginContext,
  type TaskToolView,
  type TerminalCapability,
  type TerminalRequest,
} from '@factory/core'
import { resolveScopes } from '@factory/config'
import { buildServer } from '../src/server.js'
import { createService, type Service } from '../src/service.js'

const feature = await loadFeature(fileURLToPath(new URL('./tasks-api.feature', import.meta.url)))

interface Response {
  statusCode: number
  body: Record<string, unknown>
}

describeFeature(feature, ({ Background, Rule, Scenario, AfterEachScenario }) => {
  let root = ''
  let scope = ''
  let userScope = ''
  let app: FastifyInstance
  let runtime: Runtime
  let service: Service
  let response: Response
  let taskId = ''
  let runId = ''
  let stream: { lines: string[]; close: () => Promise<void> } | undefined
  /** What a stub terminal was asked to open, for the tool scenarios. */
  let opened: TerminalRequest | undefined
  /** What the recording detached launcher was asked to start. */
  let launched: TerminalRequest | undefined
  let detachedFails = false
  /** A directory holding a stub `diffity`, added to the daemon's PATH. */
  let toolBin = ''

  AfterEachScenario(async () => {
    await stream?.close()
    stream = undefined
    await app?.close()
    await service?.close()
    rmSync(root, { recursive: true, force: true })
  })

  const file = (path: string, contents: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  }

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const raw = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
    })
    // Returns nothing: the step callbacks are typed `void`, and a concise arrow
    // that returns the response fails the typecheck while the tests pass.
    response = {
      statusCode: raw.statusCode,
      body: raw.body === '' ? {} : (JSON.parse(raw.body) as Record<string, unknown>),
    }
  }

  // Built in Background: Background steps run before anything in
  // BeforeEachScenario exists.
  Background(({ Given, And }) => {
    Given('a running daemon with a project scope', async () => {
      root = mkdtempSync(join(tmpdir(), 'factory-tasks-api-'))
      scope = join(root, 'work', '.xaedalon', '.factory')
      // The scope every project shares, as opposed to the one that belongs to
      // the directory the daemon happens to have been started in.
      userScope = join(root, 'home', '.xaedalon', '.factory')
      mkdirSync(join(root, 'work', '.git'), { recursive: true })
      file(join(scope, 'config.yaml'), 'kind: factory.scope/v1\nscope: project\n')
      // The user scope has to exist for settings to be saved into it, which is
      // how a plugin gets switched off.
      file(join(userScope, 'config.yaml'), 'kind: factory.scope/v1\nscope: user\n')

      opened = undefined
      launched = undefined
      detachedFails = false
      // Its own directory on PATH, so a scenario can install a stub tool
      // without depending on what this machine happens to have.
      toolBin = join(root, 'bin')
      mkdirSync(toolBin, { recursive: true })
      const env = {
        FACTORY_HOME: userScope,
        PATH: [toolBin, process.env.PATH].filter((part) => part !== undefined).join(delimiter),
      }
      const chain = resolveScopes({ cwd: join(root, 'work'), env })
      // Kept, so a scenario can load a capability into the host afterwards.
      // `host.has` is asked at request time, so registering one later is the
      // same as having started with it.
      runtime = await createRuntime({ cwd: join(root, 'work'), env, chain })
      service = await createService(runtime, { file: join(root, 'state.db') })
      app = buildServer(runtime, service, {
        // Recorded rather than started: what matters is the argv a tool asked
        // for, and a real detached child would outlive the scenario.
        launch: async (request) => {
          launched = request
          return detachedFails
            ? { opened: false, reason: 'it would not start', command: '' }
            : { opened: true, command: '' }
        },
      })
      await app.ready()
    })
    And('a workflow "hello" that prints "hello"', () => {
      file(join(scope, 'workflows', 'hello.workflow.yaml'), 'name: hello\nphases: [greet]\n')
      file(join(scope, 'phases', 'greet.phase.yaml'), 'name: greet\nsteps: [{run: echo hello}]\n')
    })
  })

  const create = async (name: string, workflows?: string[]) => {
    await call('POST', '/api/tasks', {
      name,
      ...(workflows === undefined ? {} : { workflows }),
    })
    taskId = (response.body.task as { id: string }).id
  }
  const actions = () => (response.body.actions as { action: string }[]).map((a) => a.action)
  const stateOf = () => (response.body.task as { state: string } | undefined)?.state

  const tools = () =>
    (response.body as { tools?: TaskToolView[] }).tools ?? []
  const tool = (id: string) => tools().find((entry) => entry.id === id)
  const toolIds = () => tools().map((entry) => entry.id).join(', ')

  /** A terminal that records what it was told, and does as it is asked. */
  const givenTerminal = (opens: boolean) => async (): Promise<void> => {
    opened = undefined
    await runtime.host.load({
      name: 'stub-terminal',
      version: '1.0.0',
      register(context: PluginContext) {
        context.provide(TERMINAL_KIND, {
          id: 'stub',
          open: async (request: TerminalRequest) => {
            opened = request
            return opens
              ? { opened: true, command: terminalCommand(request) }
              : {
                  opened: false,
                  reason: 'There is no terminal application here.',
                  command: terminalCommand(request),
                }
          },
        } satisfies TerminalCapability)
      },
    })
  }

  /**
   * A stub `diffity` on the daemon's PATH.
   *
   * The real one is not installed, and a scenario that needed it would pass or
   * fail according to the machine — which is the mistake "a flag that exists is
   * not a flag that works" records.
   */
  const givenDiffity = (): void => {
    const file = join(toolBin, 'diffity')
    writeFileSync(file, '#!/bin/sh\nexit 0\n')
    chmodSync(file, 0o755)
  }

  /** Poll rather than sleep: the work is asynchronous and usually quick. */
  const until = async (predicate: () => Promise<boolean>, what: string): Promise<void> => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for ${what}.`)
  }
  const reload = async (): Promise<void> => {
    await call('GET', `/api/tasks/${taskId}`)
  }

  Scenario('Creating a task', ({ When, Then, And }) => {
    When('I create the task "Add due dates"', () => create('Add due dates'))
    Then('the response is 201', () => expect(response.statusCode).toBe(201))
    And('the task is "draft"', () => expect(stateOf()).toBe('draft'))
    // `start` belongs to the scheduler. A client offered it could walk straight
    // past the concurrency cap.
    And('the available actions do not include "start"', () =>
      expect(actions()).not.toContain('start'),
    )
  })

  Scenario('A task with a workflow can be queued', ({ When, Then }) => {
    When('I create the task "Add due dates" with the workflow "hello"', () =>
      create('Add due dates', ['hello']),
    )
    Then('the available actions include "queue"', () => expect(actions()).toContain('queue'))
  })

  Scenario('Listing tasks', ({ Given, And, When, Then }) => {
    Given('the task "Add due dates" exists', () => create('Add due dates'))
    And('the task "Old news" exists and is archived', async () => {
      await create('Old news')
      await call('POST', `/api/tasks/${taskId}/actions/archive`)
    })
    When('I list the tasks', () => call('GET', '/api/tasks'))
    Then('1 task is listed', () => expect(response.body.items).toHaveLength(1))
    When('I list the tasks including archived ones', () =>
      call('GET', '/api/tasks?archived=true'),
    )
    Then('2 tasks are listed', () => expect(response.body.items).toHaveLength(2))
  })

  Scenario('Reading one task', ({ Given, When, Then, And }) => {
    Given('the task "Add due dates" exists', () => create('Add due dates'))
    When('I read the task', () => reload())
    Then('the response is 200', () => expect(response.statusCode).toBe(200))
    And('the task comes with its actions, history and runs', () => {
      expect(response.body.actions).toBeDefined()
      expect(response.body.history).toEqual([])
      expect(response.body.runs).toEqual([])
    })
  })

  Scenario('A task that does not exist', ({ When, Then }) => {
    When('I read the task "nope"', () => call('GET', '/api/tasks/nope'))
    Then('the response is 404', () => expect(response.statusCode).toBe(404))
  })

  Scenario('Assigning workflows', ({ Given, When, Then, And }) => {
    Given('the task "Add due dates" exists', () => create('Add due dates'))
    When('I assign the workflow "hello"', () =>
      call('PATCH', `/api/tasks/${taskId}`, { workflows: ['hello'] }),
    )
    Then('the task is on "hello"', () =>
      expect(entries().map((entry) => entry.workflow)).toEqual(['hello']),
    )
    And('the available actions include "queue"', () => expect(actions()).toContain('queue'))
  })

  Scenario('An action the task cannot do right now', ({ Given, When, Then, And }) => {
    Given('the task "Add due dates" exists', () => create('Add due dates'))
    When('I ask to approve the task', () =>
      call('POST', `/api/tasks/${taskId}/actions/approve`),
    )
    Then('the response is 409', () => expect(response.statusCode).toBe(409))
    And('the response says what the task can do instead', () =>
      expect(actions().length).toBeGreaterThan(0),
    )
  })

  Scenario('An action that belongs to the engine', ({ Given, When, Then }) => {
    Given('the task "Add due dates" exists with the workflow "hello"', () =>
      create('Add due dates', ['hello']),
    )
    When('I ask to start the task', () => call('POST', `/api/tasks/${taskId}/actions/start`))
    Then('the response is 409', () => expect(response.statusCode).toBe(409))
  })

  Scenario('An action that does not exist', ({ Given, When, Then }) => {
    Given('the task "Add due dates" exists', () => create('Add due dates'))
    When('I ask to teleport the task', () =>
      call('POST', `/api/tasks/${taskId}/actions/teleport`),
    )
    Then('the response is 400', () => expect(response.statusCode).toBe(400))
  })

  Scenario('Deleting a task', ({ Given, When, Then, And }) => {
    Given('the task "Add due dates" exists', () => create('Add due dates'))
    When('I delete the task', () => call('DELETE', `/api/tasks/${taskId}`))
    Then('the response is 204', () => expect(response.statusCode).toBe(204))
    And('the task is gone', async () => {
      await reload()
      expect(response.statusCode).toBe(404)
    })
  })

  const queueAndFinish = async () => {
    await call('POST', `/api/tasks/${taskId}/actions/queue`)
    await until(async () => {
      await reload()
      return stateOf() === 'done'
    }, 'the task to finish')
  }

  Scenario('Queueing a task runs it', ({ Given, When, And, Then }) => {
    Given('the task "Add due dates" exists with the workflow "hello"', () =>
      create('Add due dates', ['hello']),
    )
    // Nothing else pushes it along: the daemon's own scheduler notices the
    // transition and hands it to the engine.
    When('I queue the task', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
    And('the work finishes', () =>
      until(async () => {
        await reload()
        return stateOf() === 'done'
      }, 'the task to finish'),
    )
    Then('the task is "done"', () => expect(stateOf()).toBe('done'))
    And('the task has a run', () => {
      const runs = response.body.runs as { id: string; state: string }[]
      expect(runs).toHaveLength(1)
      runId = runs[0]?.id as string
    })
    And('the run is "completed"', () =>
      expect((response.body.runs as { state: string }[])[0]?.state).toBe('completed'),
    )
  })

  Scenario("A run's steps and output are readable", ({ Given, And, When, Then }) => {
    Given('the task "Add due dates" exists with the workflow "hello"', () =>
      create('Add due dates', ['hello']),
    )
    And('the task has been queued and has finished', async () => {
      await queueAndFinish()
      runId = (response.body.runs as { id: string }[])[0]?.id as string
    })
    When('I read the run', () => call('GET', `/api/runs/${runId}`))
    Then('the run has 1 step', () => expect(response.body.steps).toHaveLength(1))
    And('the step\'s output contains "hello"', async () => {
      const step = (response.body.steps as { id: number }[])[0]
      await call('GET', `/api/runs/${runId}/logs?step=${step?.id}`)
      const lines = response.body.lines as { text: string }[]
      expect(lines.map((line) => line.text).join('')).toContain('hello')
    })
    And('nothing was dropped from the output', () => expect(response.body.dropped).toBe(0))
  })

  let projectId = ''

  const addProject = async (name: string, path: string, usesWorktrees?: boolean) => {
    await call('POST', '/api/projects', {
      name,
      path,
      ...(usesWorktrees === undefined ? {} : { usesWorktrees }),
    })
    projectId = (response.body.project as { id: string } | undefined)?.id ?? ''
  }

  /** A real repository with a commit: `git worktree add` needs a HEAD. */
  const makeRepository = (at: string): string => {
    mkdirSync(at, { recursive: true })
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: at,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
      })
    git('init', '--initial-branch=main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Factory Test')
    writeFileSync(join(at, 'README.md'), '# repo\n')
    git('add', '.')
    git('commit', '-m', 'first')
    return at
  }
  const usesWorktrees = () => (response.body.project as { usesWorktrees: boolean }).usesWorktrees

  Scenario('Adding a project', ({ When, Then, And }) => {
    When('I add the project "work" at the scope\'s directory', () =>
      addProject('work', join(root, 'work')),
    )
    Then('the response is 201', () => expect(response.statusCode).toBe(201))
    And('the project is listed', async () => {
      await call('GET', '/api/projects')
      expect(response.body.items).toHaveLength(1)
    })
  })

  Scenario('A project at a path that does not exist is refused', ({ When, Then, And }) => {
    When('I add the project "ghost" at a path that does not exist', () =>
      addProject('ghost', join(root, 'nowhere')),
    )
    Then('the response is 400', () => expect(response.statusCode).toBe(400))
    And('the response explains why', () =>
      expect(String(response.body.error)).toContain('nowhere'),
    )
  })

  Scenario('A task can be given a project', ({ Given, When, Then, And }) => {
    Given('the project "work" exists', () => addProject('work', join(root, 'work')))
    When('I create the task "Add due dates" in that project', async () => {
      await call('POST', '/api/tasks', { name: 'Add due dates', projectId })
      taskId = (response.body.task as { id: string }).id
    })
    Then('the response is 201', () => expect(response.statusCode).toBe(201))
    And('the task belongs to the project', () =>
      expect((response.body.task as { projectId?: string }).projectId).toBe(projectId),
    )
  })

  Scenario("A task in a project runs in that project's directory", ({
    Given,
    And,
    When,
    Then,
  }) => {
    // A different directory on purpose: the daemon's own cwd is `work`, so a
    // project pointing there would pass this scenario without the project
    // being consulted at all.
    Given('a project in a directory the daemon was not started in', async () => {
      mkdirSync(join(root, 'elsewhere'), { recursive: true })
      await addProject('elsewhere', join(root, 'elsewhere'))
    })
    And('a workflow "where" that prints the directory it runs in', () => {
      // In the user scope, which every project can see. The daemon's own
      // project scope is not in a registered project's chain — that is the
      // point of a project having one.
      file(join(userScope, 'workflows', 'where.workflow.yaml'), 'name: where\nphases: [pwd]\n')
      file(join(userScope, 'phases', 'pwd.phase.yaml'), 'name: pwd\nsteps: [{run: pwd}]\n')
    })
    And('the task "Add due dates" exists in that project with the workflow "where"', async () => {
      await call('POST', '/api/tasks', {
        name: 'Add due dates',
        projectId,
        workflows: ['where'],
      })
      taskId = (response.body.task as { id: string }).id
    })
    When('I queue the task', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
    And('the work finishes', () =>
      until(async () => {
        await reload()
        return stateOf() === 'done'
      }, 'the task to finish'),
    )
    // The daemon was started elsewhere; the run has to happen in the project.
    Then("the output names the project's directory", async () => {
      const run = (response.body.runs as { id: string }[])[0]
      await call('GET', `/api/runs/${run?.id}`)
      const step = (response.body.steps as { id: number }[])[0]
      await call('GET', `/api/runs/${run?.id}/logs?step=${step?.id}`)
      const text = (response.body.lines as { text: string }[]).map((line) => line.text).join('')
      expect(text).toContain(join(root, 'elsewhere'))
    })
  })

  Scenario('A task gets its own worktree, and the work happens there', ({
    Given,
    And,
    When,
    Then,
  }) => {
    let repo = ''
    let worktrees = ''
    Given('a project that is a real git repository', async () => {
      repo = join(root, 'repo')
      mkdirSync(repo, { recursive: true })
      // A real repository with a commit: `git worktree add` needs a HEAD, and
      // faking one would test the fake.
      const git = (...args: string[]) =>
        execFileSync('git', args, {
          cwd: repo,
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        })
      git('init', '--initial-branch=main')
      git('config', 'user.email', 'test@example.com')
      git('config', 'user.name', 'Factory Test')
      writeFileSync(join(repo, 'README.md'), '# repo\n')
      git('add', '.')
      git('commit', '-m', 'first')
      await addProject('repo', repo)
      worktrees = ((await app.inject({ method: 'GET', url: '/api/projects' })).json() as {
        items: { worktreesRoot: string }[]
      }).items[0]?.worktreesRoot as string
    })
    And('the task "Add due dates" in it, on "worktree-create" and then "where"', async () => {
      // In the user scope, which every project can see. The daemon's own
      // project scope is not in a registered project's chain — that is the
      // point of a project having one.
      file(join(userScope, 'workflows', 'where.workflow.yaml'), 'name: where\nphases: [pwd]\n')
      file(join(userScope, 'phases', 'pwd.phase.yaml'), 'name: pwd\nsteps: [{run: pwd}]\n')
      await call('POST', '/api/tasks', {
        name: 'Add due dates',
        projectId,
        branch: 'feature/due-dates',
        workflows: ['worktree-create', 'where'],
      })
      taskId = (response.body.task as { id: string }).id
    })
    When('I queue the task', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
    And('the work finishes', () =>
      until(async () => {
        await reload()
        return stateOf() === 'done' || stateOf() === 'blocked'
      }, 'the task to finish'),
    )
    Then('the task has the flag "hasWorktree"', () => {
      expect((response.body.task as { flags: string[] }).flags).toContain('hasWorktree')
    })
    And('a worktree exists for the task', () => {
      const directory = (response.body.task as { directory: string }).directory
      expect(existsSync(join(worktrees, directory))).toBe(true)
    })
    // The whole point of the worktree: everything after it happens in there,
    // not in the repository other tasks are using.
    And('the second workflow ran inside the worktree', async () => {
      const directory = (response.body.task as { directory: string }).directory
      const runs = response.body.runs as { id: string; workflow: string }[]
      const where = runs.find((run) => run.workflow === 'where')
      await call('GET', `/api/runs/${where?.id}`)
      const step = (response.body.steps as { id: number }[])[0]
      await call('GET', `/api/runs/${where?.id}/logs?step=${step?.id}`)
      const text = (response.body.lines as { text: string }[]).map((line) => line.text).join('')
      expect(text).toContain(join(worktrees, directory))
    })
  })

  const stepFor = (id: string) =>
    (response.body.items as { id: string; done: boolean; essential?: boolean }[]).find(
      (item) => item.id === id,
    )

  Scenario('Setup says what is still missing', ({ When, Then, And }) => {
    When('I ask what setup is left', () => call('GET', '/api/setup'))
    Then('the response is 200', () => expect(response.statusCode).toBe(200))
    // Contributed by the engine, because it is the only part that can see the
    // database a project lives in.
    And('adding a repository is one of the steps', () =>
      expect(stepFor('a-project')).toBeDefined(),
    )
    And('it is marked essential', () => expect(stepFor('a-project')?.essential).toBe(true))
  })

  Scenario('Adding a repository finishes that step', ({ Given, When, Then }) => {
    Given('the project "work" exists', () => addProject('work', join(root, 'work')))
    When('I ask what setup is left', () => call('GET', '/api/setup'))
    Then('adding a repository is done', () => expect(stepFor('a-project')?.done).toBe(true))
  })

  // Helpers above the Rule: a Rule block is a nested describe, and anything it
  // reaches for has to exist by the time the file is read.
  let projectRoot = ''

  /** A project with a `.factory` of its own, holding a workflow nobody else has. */
  const projectWithItsOwnWorkflow = async (): Promise<void> => {
    projectRoot = join(root, 'own')
    mkdirSync(projectRoot, { recursive: true })
    const own = join(projectRoot, '.xaedalon', '.factory')
    file(join(own, 'config.yaml'), 'kind: factory.scope/v1\nscope: project\n')
    file(join(own, 'workflows', 'deploy.workflow.yaml'), 'name: deploy\nphases: [ship]\n')
    file(join(own, 'phases', 'ship.phase.yaml'), "name: ship\nsteps: [{run: echo shipping}]\n")
    await addProject('own', projectRoot)
  }

  const listed = () => response.body.items as { name: string; winner: { scope: string } }[]
  const entry = (name: string) => listed().find((item) => item.name === name)

  /**
   * The output of every step of the newest run, as one string. Per step,
   * because run-level logs and step logs are kept apart on purpose.
   */
  const outputOfLatestRun = async (): Promise<string> => {
    await call('GET', `/api/tasks/${taskId}`)
    const run = (response.body.runs as { id: string }[])[0]
    await call('GET', `/api/runs/${run?.id}`)
    const steps = response.body.steps as { id: number }[]
    let text = ''
    for (const step of steps) {
      await call('GET', `/api/runs/${run?.id}/logs?step=${step.id}`)
      text += (response.body.lines as { text: string }[]).map((line) => line.text).join('')
    }
    return text
  }

  /** The task's workflow entries as the wire carries them. */
  const entries = () =>
    (response.body.task as { workflows: { workflow: string; enabled: boolean; ran: boolean }[] })
      .workflows

  Rule("A project's definitions are its own", ({ RuleScenario }) => {
    RuleScenario("A project's own workflows are listed for that project", ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('a project with a workflow of its own', projectWithItsOwnWorkflow)
      When('I list the workflows for that project', () =>
        call('GET', `/api/workflows?project=${projectId}`),
      )
      Then('"deploy" is listed', () => expect(entry('deploy')).toBeDefined())
      And('it says it came from the project', () =>
        expect(entry('deploy')?.winner.scope).toBe('project'),
      )
    })

    RuleScenario("A project sees the installation's workflows too", ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a workflow "greeting" everyone shares', () => {
        file(join(userScope, 'workflows', 'greeting.workflow.yaml'), 'name: greeting\nphases: []\n')
      })
      And('a project with a workflow of its own', projectWithItsOwnWorkflow)
      When('I list the workflows for that project', () =>
        call('GET', `/api/workflows?project=${projectId}`),
      )
      Then('"greeting" is listed', () => expect(entry('greeting')).toBeDefined())
      And('it says it came from the user', () =>
        expect(entry('greeting')?.winner.scope).toBe('user'),
      )
    })

    RuleScenario("A project's own workflow belongs to nobody else", ({ Given, When, Then }) => {
      Given('a project with a workflow of its own', projectWithItsOwnWorkflow)
      When('I list the workflows', () => call('GET', '/api/workflows'))
      Then('"deploy" is not listed', () => expect(entry('deploy')).toBeUndefined())
    })

    RuleScenario('Asking about a project that does not exist', ({ When, Then }) => {
      When('I list the workflows for a project that does not exist', () =>
        call('GET', '/api/workflows?project=nope'),
      )
      Then('the response is 404', () => expect(response.statusCode).toBe(404))
    })

    RuleScenario('A task runs a workflow its own project defines', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a project with a workflow of its own', projectWithItsOwnWorkflow)
      And('the task "Ship it" exists in that project with the workflow "deploy"', async () => {
        await call('POST', '/api/tasks', {
          name: 'Ship it',
          projectId,
          workflows: ['deploy'],
        })
        taskId = (response.body.task as { id: string }).id
      })
      When('I queue it', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
      And('the work finishes', () =>
        until(async () => {
          await reload()
          return stateOf() === 'done' || stateOf() === 'blocked'
        }, 'the work to finish'),
      )
      // The daemon was started in a directory that has never heard of "deploy".
      Then("the output says the project's own workflow ran", async () => {
        expect(await outputOfLatestRun()).toContain('shipping')
      })
    })
  })

  Rule('A plan can only be changed while the task is not carrying it out', ({ RuleScenario }) => {
    RuleScenario('Workflows cannot be changed while the task is running', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a workflow "waiting" that takes its time', () => {
        file(join(scope, 'workflows', 'waiting.workflow.yaml'), 'name: waiting\nphases: [linger]\n')
        file(join(scope, 'phases', 'linger.phase.yaml'), 'name: linger\nsteps: [{run: sleep 2}]\n')
      })
      And('the task "Add due dates" exists with the workflow "waiting"', () =>
        create('Add due dates', ['waiting']),
      )
      When('I queue it', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
      And('it is running', () =>
        until(async () => {
          await reload()
          return stateOf() === 'running'
        }, 'the task to start running'),
      )
      And('I assign the workflow "hello"', () =>
        call('PATCH', `/api/tasks/${taskId}`, { workflows: ['hello'] }),
      )
      Then('the response is 409', () => expect(response.statusCode).toBe(409))
      And('it says the task is running', () => expect(response.body.state).toBe('running'))
    })

    RuleScenario('An edit keeps what has run and adds what is new', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      And('the work finishes', queueAndFinish)
      // The first `hello` claims the entry that ran — matching prefers one that
      // has — and the second is new. This used to send the task back to the
      // start, so the workflow that had already succeeded ran again.
      When('I assign a different list of workflows', () =>
        call('PATCH', `/api/tasks/${taskId}`, { workflows: ['hello', 'hello'] }),
      )
      Then('the workflow that ran is still marked as having run', () =>
        expect(entries()[0]).toMatchObject({ workflow: 'hello', ran: true, enabled: false }),
      )
      And('the one just added is ticked', () =>
        expect(entries()[1]).toMatchObject({ workflow: 'hello', ran: false, enabled: true }),
      )
    })

    RuleScenario('A workflow that has already run cannot be taken off the list', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      And('the work finishes', queueAndFinish)
      When('I take every workflow off the list', () =>
        call('PATCH', `/api/tasks/${taskId}`, { workflows: [] }),
      )
      // A state conflict, like the in-flight refusal: the request is fine, the
      // task simply will not let go of something it has already run.
      Then('the response is 409', () => expect(response.statusCode).toBe(409))
      And('the refusal names "hello"', () =>
        expect(String((response.body as { error?: string }).error)).toContain('hello'),
      )
    })
  })

  Scenario('Health reports what the boot recovered', ({ When, Then, And }) => {
    When('I ask for health', () => call('GET', '/api/health'))
    Then('the response is 200', () => expect(response.statusCode).toBe(200))
    And('health says how many runs were recovered', () =>
      expect((response.body.recovered as { runs: number }).runs).toBe(0),
    )
  })

  Scenario('The live stream carries what happens', ({ Given, When, Then }) => {
    Given('I am listening to the live stream', async () => {
      // A real socket: `inject` has no streaming response to read from, and the
      // thing being tested is that the response streams.
      await app.listen({ host: '127.0.0.1', port: 0 })
      const address = app.server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const controller = new AbortController()
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
        signal: controller.signal,
      })
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      const lines: string[] = []
      const decoder = new TextDecoder()
      const pump = (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) return
            lines.push(decoder.decode(value))
          }
        } catch {
          // Aborted by the scenario; that is how this ends.
        }
      })()
      stream = {
        lines,
        close: async () => {
          controller.abort()
          await pump
        },
      }
    })
    When('I create the task "Add due dates"', () => create('Add due dates'))
    Then('the stream delivers "task.created"', () =>
      until(
        async () => (stream?.lines ?? []).join('').includes('task.created'),
        'the event to arrive',
      ),
    )
  })

  Scenario('Stopping does not wait for a live stream for ever', ({ Given, When, Then }) => {
    let stopped = 'not asked'

    Given('I am listening to the live stream', async () => {
      await app.listen({ host: '127.0.0.1', port: 0 })
      const address = app.server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const controller = new AbortController()
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
        signal: controller.signal,
      })
      // Read one chunk so the stream is genuinely established, not merely asked
      // for — an unestablished connection would close on its own.
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      await reader.read()
      stream = {
        lines: [],
        close: async () => {
          controller.abort()
          await reader.cancel().catch(() => undefined)
        },
      }
    })

    When('the server is asked to stop', async () => {
      // Deliberately *not* closing the stream first. That is the whole point:
      // the board is still connected when the engine is told to stop.
      stopped = await Promise.race([
        app.close().then(() => 'stopped'),
        new Promise<string>((resolve) => {
          const late = setTimeout(() => resolve('hung'), 5_000)
          late.unref()
        }),
      ])
    })

    Then('it stops rather than hanging on the open stream', () =>
      expect(stopped).toBe('stopped'),
    )
  })

  Scenario('A project can be added to work in its own checkout', ({ When, Then, And }) => {
    When('I add the project "in-place" working in its own checkout', async () => {
      mkdirSync(join(root, 'in-place'), { recursive: true })
      await addProject('in-place', join(root, 'in-place'), false)
    })
    Then('the response is 201', () => expect(response.statusCode).toBe(201))
    And('the project does not use worktrees', () => expect(usesWorktrees()).toBe(false))
  })

  Scenario('Worktrees can be turned off on a project that already exists', ({
    Given,
    When,
    Then,
    And,
  }) => {
    Given('a project that is a real git repository', async () => {
      await addProject('repo', makeRepository(join(root, 'repo')))
    })
    When('I turn its worktrees off', () =>
      call('PATCH', `/api/projects/${projectId}`, { usesWorktrees: false }),
    )
    Then('the response is 200', () => expect(response.statusCode).toBe(200))
    And('the project does not use worktrees', () => expect(usesWorktrees()).toBe(false))
  })

  Scenario('Turning worktrees on where there is no repository is refused', ({
    Given,
    When,
    Then,
    And,
  }) => {
    // The scope's own `work` directory is a repository, so this needs one that
    // is not — which is the whole point of the refusal.
    Given('a project at a directory that is not a repository', async () => {
      mkdirSync(join(root, 'plain'), { recursive: true })
      await addProject('plain', join(root, 'plain'))
    })
    When('I turn its worktrees on', () =>
      call('PATCH', `/api/projects/${projectId}`, { usesWorktrees: true }),
    )
    Then('the response is 400', () => expect(response.statusCode).toBe(400))
    And('the response says it is not a git repository', () =>
      expect(String(response.body.error)).toContain('not a git repository'),
    )
  })

  Scenario('Changing a project that does not exist is not found', ({ When, Then }) => {
    When('I turn worktrees off on a project that does not exist', () =>
      call('PATCH', '/api/projects/nope', { usesWorktrees: false }),
    )
    Then('the response is 404', () => expect(response.statusCode).toBe(404))
  })

  Scenario('A change that says nothing is refused', ({ Given, When, Then }) => {
    Given('the project "work" exists', () => addProject('work', join(root, 'work')))
    When('I send a change with no setting in it', () =>
      call('PATCH', `/api/projects/${projectId}`, {}),
    )
    Then('the response is 400', () => expect(response.statusCode).toBe(400))
  })

  Scenario('A task in a project that works in its own checkout runs there', ({
    Given,
    And,
    When,
    Then,
  }) => {
    let repo = ''
    Given('a project that is a real git repository, working in its own checkout', async () => {
      repo = makeRepository(join(root, 'in-place-repo'))
      await addProject('in-place-repo', repo, false)
    })
    // The hazard this closes: before the setting existed, any directory sitting
    // under the worktrees root won the existence check.
    And('a worktree directory left over from before', async () => {
      await call('GET', '/api/projects')
      const project = (response.body.items as { worktreesRoot: string; name: string }[]).find(
        (entry) => entry.name === 'in-place-repo',
      )
      mkdirSync(join(project?.worktreesRoot as string, 'add-due-dates'), { recursive: true })
    })
    And('the task "Add due dates" exists in that project with the workflow "where"', async () => {
      // In the user scope, which every project can see. The daemon's own
      // project scope is not in a registered project's chain — that is the
      // point of a project having one.
      file(join(userScope, 'workflows', 'where.workflow.yaml'), 'name: where\nphases: [pwd]\n')
      file(join(userScope, 'phases', 'pwd.phase.yaml'), 'name: pwd\nsteps: [{run: pwd}]\n')
      await call('POST', '/api/tasks', {
        name: 'Add due dates',
        projectId,
        workflows: ['where'],
      })
      taskId = (response.body.task as { id: string }).id
    })
    When('I queue the task', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
    And('the work finishes', () =>
      until(async () => {
        await reload()
        return stateOf() === 'done'
      }, 'the task to finish'),
    )
    Then('the output names the repository itself, not the leftover worktree', async () => {
      const run = (response.body.runs as { id: string }[])[0]
      await call('GET', `/api/runs/${run?.id}`)
      const step = (response.body.steps as { id: number }[])[0]
      await call('GET', `/api/runs/${run?.id}/logs?step=${step?.id}`)
      const text = (response.body.lines as { text: string }[]).map((line) => line.text).join('')
      expect(text).toContain(repo)
      expect(text).not.toContain('add-due-dates')
    })
  })

  Rule('A task can be renamed, and agents are definitions like any other', ({ RuleScenario }) => {
    let directoryBefore = ''

    const rename = async (to: string): Promise<void> => {
      directoryBefore = (response.body.task as { directory?: string } | undefined)?.directory ?? ''
      await call('PATCH', `/api/tasks/${taskId}`, { name: to })
    }
    const nameOf = () => (response.body.task as { name: string }).name

    RuleScenario('A task can be renamed', ({ Given, When, Then, And }) => {
      Given('the task "Add due dates" exists', () => create('Add due dates'))
      When('I rename it to "Add due dates and times"', () => rename('Add due dates and times'))
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And('the task is called "Add due dates and times"', () =>
        expect(nameOf()).toBe('Add due dates and times'),
      )
    })

    RuleScenario('Renaming does not move where its work lives', ({ Given, When, Then }) => {
      Given('the task "Add due dates" exists', () => create('Add due dates'))
      When('I rename it to "Something else entirely"', () => rename('Something else entirely'))
      // The worktree was created at this directory. Re-deriving it from the new
      // name would leave the work in a directory nothing points at any more.
      Then('its directory is unchanged', () => {
        expect((response.body.task as { directory?: string }).directory).toBe(directoryBefore)
        expect(directoryBefore).not.toBe('')
      })
    })

    RuleScenario('A task cannot be renamed while it is running', ({ Given, And, When, Then }) => {
      Given('a workflow "waiting" that takes its time', () => {
        file(join(scope, 'workflows', 'waiting.workflow.yaml'), 'name: waiting\nphases: [linger]\n')
        file(join(scope, 'phases', 'linger.phase.yaml'), 'name: linger\nsteps: [{run: sleep 2}]\n')
      })
      And('the task "Add due dates" exists with the workflow "waiting"', () =>
        create('Add due dates', ['waiting']),
      )
      When('I queue it', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
      And('it is running', () =>
        until(async () => {
          await reload()
          return stateOf() === 'running'
        }, 'the task to start running'),
      )
      And('I rename it to "Too late"', () => call('PATCH', `/api/tasks/${taskId}`, { name: 'Too late' }))
      // `{{ task.name }}` is substituted into every plan, so a rename mid-run
      // would change what a later phase renders.
      Then('the response is 409', () => expect(response.statusCode).toBe(409))
    })

    RuleScenario('A change that says nothing at all is refused', ({ Given, When, Then }) => {
      Given('the task "Add due dates" exists', () => create('Add due dates'))
      When('I send a change with neither a name nor workflows', () =>
        call('PATCH', `/api/tasks/${taskId}`, {}),
      )
      Then('the response is 400', () => expect(response.statusCode).toBe(400))
    })

    RuleScenario('Agents are listed, written and read back', ({ When, Then }) => {
      When('I write the agent "developer"', () =>
        call('POST', '/api/agents', {
          definition: { name: 'developer', provider: 'claude', model: 'strong' },
          scope: 'project',
        }),
      )
      Then('the response is 201', () => expect(response.statusCode).toBe(201))
      When('I list the agents', () => call('GET', '/api/agents'))
      Then('"developer" is listed', () =>
        expect((response.body.items as { name: string }[]).map((i) => i.name)).toContain(
          'developer',
        ),
      )
    })

    const describeAs = async (description: unknown): Promise<void> => {
      await call('PATCH', `/api/tasks/${taskId}`, { description })
    }
    const descriptionOf = () => (response.body.task as { description: string }).description

    RuleScenario('A task can be described', ({ Given, When, Then, And }) => {
      Given('the task "Add due dates" exists', () => create('Add due dates'))
      When('I describe it as "Every todo gets an optional due date."', () =>
        describeAs('Every todo gets an optional due date.'),
      )
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And('the task\'s description is "Every todo gets an optional due date."', () =>
        expect(descriptionOf()).toBe('Every todo gets an optional due date.'),
      )
    })

    RuleScenario('A description can be cleared, unlike a name', ({ Given, When, Then, And }) => {
      Given('the task "Add due dates" exists', () => create('Add due dates'))
      // '' is how you clear prose. The same value for a name is refused,
      // because a task with no name is not findable on the board.
      When('I describe it as ""', () => describeAs(''))
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And("the task's description is empty", () => expect(descriptionOf()).toBe(''))
    })

    RuleScenario('A description that is not text is refused', ({ Given, When, Then }) => {
      Given('the task "Add due dates" exists', () => create('Add due dates'))
      When('I describe it as the number 7', () => describeAs(7))
      Then('the response is 400', () => expect(response.statusCode).toBe(400))
    })

    RuleScenario('The description a task was created with is kept', ({ Given, Then }) => {
      Given('the task "Add due dates" is created with a description', async () => {
        await call('POST', '/api/tasks', {
          name: 'Add due dates',
          description: 'Every todo gets an optional due date.',
        })
        taskId = (response.body.task as { id: string }).id
      })
      Then('the task\'s description is "Every todo gets an optional due date."', () =>
        expect(descriptionOf()).toBe('Every todo gets an optional due date.'),
      )
    })

    RuleScenario('A step can write the description into its prompt', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a project with a workflow whose step echoes "{{ task.description }}"', async () => {
        file(join(scope, 'workflows', 'brief.workflow.yaml'), 'name: brief\nphases: [say]\n')
        file(
          join(scope, 'phases', 'say.phase.yaml'),
          'name: say\nsteps: [{run: \'echo "{{ task.description }}"\'}]\n',
        )
        await addProject('briefed', join(root, 'work'))
      })
      And(
        'the task "Ship it" exists in that project with that workflow and a description',
        async () => {
          await call('POST', '/api/tasks', {
            name: 'Ship it',
            description: 'Every todo gets an optional due date.',
            projectId,
            workflows: ['brief'],
          })
          taskId = (response.body.task as { id: string }).id
        },
      )
      When('I queue it', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
      And('the work finishes', () =>
        until(async () => {
          await reload()
          return stateOf() === 'done' || stateOf() === 'blocked'
        }, 'the work to finish'),
      )
      // The whole point of the token: what the person asked for, in the prompt,
      // without them pasting it in twice.
      Then('the output says what the task was for', async () => {
        expect(await outputOfLatestRun()).toContain('Every todo gets an optional due date.')
      })
    })

    RuleScenario('A step can name an agent and the plan uses its model', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a project with an agent "developer" and a workflow that uses it', async () => {
        // The agent names no provider, so nothing has to be installed for this
        // to plan — what is under test is that the *name* resolves and its
        // settings reach the step.
        file(
          join(scope, 'agents', 'developer.agent.yaml'),
          'name: developer\nmodel: strong\nsubagent: implementer\n',
        )
        file(join(scope, 'workflows', 'greeting.workflow.yaml'), 'name: greeting\nphases: [speak]\n')
        file(
          join(scope, 'phases', 'speak.phase.yaml'),
          'name: speak\nsteps: [{run: echo "developer ran"}]\n',
        )
        await addProject('agentic', join(root, 'work'))
      })
      And('the task "Ship it" exists in that project with the workflow "greeting"', async () => {
        await call('POST', '/api/tasks', {
          name: 'Ship it',
          projectId,
          workflows: ['greeting'],
        })
        taskId = (response.body.task as { id: string }).id
      })
      When('I queue it', () => call('POST', `/api/tasks/${taskId}/actions/queue`))
      And('the work finishes', () =>
        until(async () => {
          await reload()
          return stateOf() === 'done' || stateOf() === 'blocked'
        }, 'the work to finish'),
      )
      Then('the output says which agent ran', async () => {
        expect(await outputOfLatestRun()).toContain('developer ran')
      })
    })
  })

  Rule('Turning a project setting on gives the project its own copies', ({ RuleScenario }) => {
    const scaffolded = () => response.body.scaffolded as { written: string[] }
    const usesEnvironments = () =>
      (response.body.project as { usesEnvironments: boolean }).usesEnvironments

    RuleScenario('Turning environments on scaffolds the environment workflows', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the project "work" exists', () => addProject('work', join(root, 'work')))
      When('I turn environments on', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesEnvironments: true }),
      )
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And('the project uses environments', () => expect(usesEnvironments()).toBe(true))
      And('"environment-create" was written into the project', () =>
        expect(scaffolded().written.some((f) => f.includes('environment-create'))).toBe(true),
      )
    })

    RuleScenario('Those copies resolve from the project afterwards', ({
      Given,
      When,
      And,
      Then,
    }) => {
      Given('the project "work" exists', () => addProject('work', join(root, 'work')))
      When('I turn environments on', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesEnvironments: true }),
      )
      And('I list the workflows for that project', () =>
        call('GET', `/api/workflows?project=${projectId}`),
      )
      Then('"environment-create" came from the project', () => {
        const found = (response.body.items as { name: string; winner: { scope: string } }[]).find(
          (item) => item.name === 'environment-create',
        )
        expect(found?.winner.scope).toBe('project')
      })
    })

    RuleScenario('Turning a setting off writes nothing and removes nothing', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the project "work" exists', () => addProject('work', join(root, 'work')))
      And('environments are on', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesEnvironments: true }),
      )
      When('I turn environments off', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesEnvironments: false }),
      )
      Then('the project does not use environments', () => expect(usesEnvironments()).toBe(false))
      // The files are the project's now. Deleting someone's committed workflow
      // because they unticked a box would be unforgivable.
      And('nothing was written', () => expect(scaffolded().written).toEqual([]))
    })
  })

  Rule('A workflow gated on a facility the project has switched off is not offered', ({
    RuleScenario,
  }) => {
    const listing = (name: string) =>
      (
        response.body.items as {
          name: string
          unavailable?: { flag: string; setting: string }
        }[]
      ).find((item) => item.name === name)

    const givenProject = () => addProject('work', join(root, 'work'))
    const listWorkflows = () => call('GET', `/api/workflows?project=${projectId}`)

    RuleScenario('Worktree workflows are unavailable where worktrees are off', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the project "work" exists', givenProject)
      // Worktrees are on by default for a new project — unlike environments,
      // which a project has to opt into. So this one has to be switched off.
      And('worktrees are off', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesWorktrees: false }),
      )
      When('I list the workflows for that project', listWorkflows)
      Then('"worktree-create" is unavailable because of "worktrees"', () =>
        expect(listing('worktree-create')?.unavailable?.setting).toBe('worktrees'),
      )
      And('"worktree-delete" is unavailable because of "worktrees"', () =>
        expect(listing('worktree-delete')?.unavailable?.setting).toBe('worktrees'),
      )
    })

    RuleScenario('A project that uses worktrees is offered them', ({ Given, When, Then }) => {
      Given('the project "work" exists', givenProject)
      When('I list the workflows for that project', listWorkflows)
      Then('"worktree-create" is available', () =>
        expect(listing('worktree-create')?.unavailable).toBeUndefined(),
      )
    })

    RuleScenario('A workflow that only requires the flag is unavailable too', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the project "work" exists', givenProject)
      And('environments are on', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesEnvironments: true }),
      )
      // `environment-update` neither provides nor clears — it only requires.
      // A consumer of a flag nothing can provide is as stuck as a producer.
      When('I turn environments off', () =>
        call('PATCH', `/api/projects/${projectId}`, { usesEnvironments: false }),
      )
      And('I list the workflows for that project', listWorkflows)
      Then('"environment-update" is unavailable because of "environments"', () =>
        expect(listing('environment-update')?.unavailable?.setting).toBe('environments'),
      )
    })

    RuleScenario('A renamed copy is judged by its flags, not its name', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the project "work" exists', givenProject)
      // The whole reason this matches on conditions: a name nobody shipped.
      And('the project has its own workflow "spin-up" that provides "hasEnvironment"', () => {
        file(
          join(scope, 'workflows', 'spin-up.workflow.yaml'),
          'name: spin-up\nconditions: {provides: [hasEnvironment]}\nphases: [speak]\n',
        )
        file(join(scope, 'phases', 'speak.phase.yaml'), 'name: speak\nsteps: [{run: echo hi}]\n')
      })
      When('I list the workflows for that project', listWorkflows)
      Then('"spin-up" is unavailable because of "environments"', () =>
        expect(listing('spin-up')?.unavailable?.setting).toBe('environments'),
      )
    })

    RuleScenario('A workflow that deals in neither is always offered', ({
      Given,
      When,
      Then,
    }) => {
      Given('the project "work" exists', async () => {
        file(join(scope, 'workflows', 'greeting.workflow.yaml'), 'name: greeting\nphases: [speak]\n')
        file(join(scope, 'phases', 'speak.phase.yaml'), 'name: speak\nsteps: [{run: echo hi}]\n')
        await givenProject()
      })
      When('I list the workflows for that project', listWorkflows)
      Then('"greeting" is available', () =>
        expect(listing('greeting')?.unavailable).toBeUndefined(),
      )
    })
  })

  Rule('progress counts phases across the whole plan', ({ RuleScenario }) => {
    const listed = (name: string) =>
      (
        response.body.items as {
          name: string
          progress?: { completed: number; total: number }
        }[]
      ).find((task) => task.name === name)

    const askForList = () => call('GET', '/api/tasks?archived=true')
    const reports = (progress: { completed: number; total: number } | undefined, done: number, total: number) => {
      expect(progress).toEqual({ completed: done, total })
    }

    RuleScenario('A task that has run nothing reports none of its phases', ({
      Given,
      When,
      Then,
    }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      When('I ask for the task list', askForList)
      // Zero of something, not nothing at all: a fresh task used to have no
      // progress field whatever, so the board drew a dash.
      Then('"Add due dates" reports 0 of 1 phases', () =>
        reports(listed('Add due dates')?.progress, 0, 1),
      )
    })

    RuleScenario('A finished workflow reports its phases', ({ Given, And, When, Then }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      And('the work finishes', queueAndFinish)
      When('I ask for the task list', askForList)
      Then('"Add due dates" reports 1 of 1 phases', () =>
        reports(listed('Add due dates')?.progress, 1, 1),
      )
    })

    RuleScenario('A workflow that ran twice counts once', ({ Given, And, When, Then }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      And('the work finishes', queueAndFinish)
      // Grouped by entry and phase, so a re-run is the same phase done again
      // rather than a second phase. Counting runs would report 2 of 1.
      And('it is ticked back on and finishes again', async () => {
        await call('GET', `/api/tasks/${taskId}`)
        const entries = (response.body.task as { workflows: { id: string; workflow: string }[] })
          .workflows
        await call('PATCH', `/api/tasks/${taskId}`, {
          workflows: entries.map((entry) => ({ ...entry, enabled: true })),
        })
        await queueAndFinish()
      })
      When('I ask for the task list', askForList)
      Then('"Add due dates" reports 1 of 1 phases', () =>
        reports(listed('Add due dates')?.progress, 1, 1),
      )
    })

    RuleScenario('Two workflows are two sets of phases', ({ Given, And, When, Then }) => {
      Given('the task "Add due dates" exists with the workflows "hello, hello"', () =>
        create('Add due dates', ['hello', 'hello']),
      )
      And('the work finishes', queueAndFinish)
      When('I ask for the task list', askForList)
      Then('"Add due dates" reports 2 of 2 phases', () =>
        reports(listed('Add due dates')?.progress, 2, 2),
      )
    })

    RuleScenario('A workflow that cannot be planned still leaves the rest counted', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the task "Add due dates" exists with the workflow "hello" then "nowhere"', () =>
        create('Add due dates', ['hello', 'nowhere']),
      )
      // A plan-time refusal writes a run with no step rows at all. That used to
      // make the whole task report nothing, so one finished workflow looked
      // like none.
      And('the work stops', async () => {
        await call('POST', `/api/tasks/${taskId}/actions/queue`)
        await until(async () => {
          await reload()
          return stateOf() === 'blocked'
        }, 'the task to block')
      })
      When('I ask for the task list', askForList)
      Then('"Add due dates" reports 1 of 1 phases', () =>
        reports(listed('Add due dates')?.progress, 1, 1),
      )
    })

    RuleScenario("The task's own page reports it too", ({ Given, And, When, Then }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      And('the work finishes', queueAndFinish)
      When('I ask for the task', () => call('GET', `/api/tasks/${taskId}`))
      Then('it reports 1 of 1 phases', () =>
        reports(
          (response.body as { progress?: { completed: number; total: number } }).progress,
          1,
          1,
        ),
      )
    })
  })

  Rule("a task's artifacts are listed, and one can be read", ({ RuleScenario }) => {
    const WRITTEN = '# Review\n\nlooks good\n'

    /**
     * A task with a run that collected an artifact.
     *
     * The evidence is attached through the store rather than produced by an
     * agent: what is under test is the two routes, and standing a stub agent on
     * PATH to get one row would be testing the engine's collection again —
     * which `engine.feature` already does.
     */
    const givenArtifact = async (): Promise<void> => {
      await create('Check it', ['hello'])
      const run = service.runs.start({ workflow: 'hello', taskId })
      service.runs.attachEvidence({
        runId: run.id,
        phase: 'greet',
        name: 'report',
        path: '/tmp/report.md',
        content: WRITTEN,
      })
      service.runs.finish(run.id, 'completed')
    }
    const artifacts = () =>
      (response.body as { artifacts?: { name: string; content?: string }[] }).artifacts ?? []

    RuleScenario('The task lists what it produced, without the content', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the task "Check it" exists with a workflow that writes a report', givenArtifact)
      And('the work finishes', () => undefined)
      When('I ask for the task', () => call('GET', `/api/tasks/${taskId}`))
      Then('"report" is one of its artifacts', () =>
        expect(artifacts().map((item) => item.name)).toEqual(['report']),
      )
      // A task detail is refetched on every live event; the content is one
      // request away, on the page that shows it.
      And('the listing carries no content', () =>
        expect(artifacts().every((item) => item.content === undefined)).toBe(true),
      )
    })

    RuleScenario('One artifact comes back with its content', ({ Given, And, When, Then }) => {
      Given('the task "Check it" exists with a workflow that writes a report', givenArtifact)
      And('the work finishes', () => undefined)
      When('I ask for the artifact "report"', () =>
        call('GET', `/api/tasks/${taskId}/artifacts/report`),
      )
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And('it carries the text that was written', () =>
        expect(
          (response.body as { versions: { content?: string }[] }).versions[0]?.content,
        ).toContain('looks good'),
      )
    })

    RuleScenario('A name it never produced is not found', ({ Given, And, When, Then }) => {
      Given('the task "Check it" exists with a workflow that writes a report', givenArtifact)
      And('the work finishes', () => undefined)
      When('I ask for the artifact "nowhere"', () =>
        call('GET', `/api/tasks/${taskId}/artifacts/nowhere`),
      )
      Then('the response is 404', () => expect(response.statusCode).toBe(404))
    })

    RuleScenario('An artifact on a task that does not exist is not found', ({ When, Then }) => {
      When('I ask for an artifact of a task that does not exist', () =>
        call('GET', '/api/tasks/nope/artifacts/report'),
      )
      Then('the response is 404', () => expect(response.statusCode).toBe(404))
    })
  })
  Rule('a task says where its work is', ({ RuleScenario }) => {
    interface Workspace {
      path: string
      inWorktree: boolean
      project: { name: string; path: string }
    }
    const workspace = () => (response.body as { workspace?: Workspace }).workspace

    const givenProject = () => addProject('work', join(root, 'work'))
    const givenTask = () =>
      call('POST', '/api/tasks', { name: 'Add due dates', projectId, workflows: ['hello'] }).then(
        () => {
          taskId = (response.body.task as { id: string }).id
        },
      )

    RuleScenario('The task detail carries the directory its steps run in', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task', reload)
      Then("its workspace is the project's directory", () =>
        expect(workspace()?.path).toBe(join(root, 'work')),
      )
      And('the workspace is not a worktree', () => expect(workspace()?.inWorktree).toBe(false))
      // The name as well as the path: the row says which project a directory
      // belongs to, and joining the two in the browser is what nobody did.
      And('the workspace names the project "work"', () =>
        expect(workspace()?.project.name).toBe('work'),
      )
    })

    RuleScenario('A worktree on the disk is where the work is', ({ Given, And, When, Then }) => {
      let worktree = ''
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      // Made by hand rather than by running `worktree-create`: what is under
      // test is that resolution *looks*, and a directory somebody created or
      // deleted outside Factory is exactly the case the rule exists for.
      And('a worktree for it exists on the disk', async () => {
        await call('GET', '/api/projects')
        const project = (response.body.items as { worktreesRoot: string }[])[0]
        await reload()
        const directory = (response.body.task as { directory: string }).directory
        worktree = join(project?.worktreesRoot as string, directory)
        mkdirSync(worktree, { recursive: true })
      })
      When('I ask for the task', reload)
      Then('its workspace is that worktree', () => expect(workspace()?.path).toBe(worktree))
      And('the workspace is a worktree', () => expect(workspace()?.inWorktree).toBe(true))
    })

    RuleScenario('A task belonging to no project has no workspace', ({
      Given,
      When,
      Then,
    }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      When('I ask for the task', reload)
      Then('it has no workspace', () => expect(workspace()).toBeUndefined())
    })

    RuleScenario('The task list does not carry it', ({ Given, And, When, Then }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task list', () => call('GET', '/api/tasks'))
      // One string per task that no list view draws, and resolving it reads a
      // project row and a phase file or two.
      Then('no listed task carries a workspace', () =>
        expect(
          (response.body.items as { workspace?: unknown }[]).every(
            (item) => item.workspace === undefined,
          ),
        ).toBe(true),
      )
    })
  })

  Rule('each tool answers its own question, and says why it cannot', ({ RuleScenario }) => {
    const givenProject = () => addProject('work', join(root, 'work'))
    const givenTask = async (): Promise<void> => {
      await call('POST', '/api/tasks', { name: 'Add due dates', projectId, workflows: ['hello'] })
      taskId = (response.body.task as { id: string }).id
    }
    const givenSession = (provider: string) => async (): Promise<void> => {
      await call('POST', '/api/tasks', { name: 'Check it', projectId, workflows: ['hello'] })
      taskId = (response.body.task as { id: string }).id
      service.tasks.rememberSession(taskId, { id: 's-99', provider })
    }

    RuleScenario('The tools come from plugins, in their own order', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task', reload)
      Then('its tools are "open-terminal, open-session, diffity"', () =>
        expect(toolIds()).toBe('open-terminal, open-session, diffity'),
      )
      // Where a button came from is worth saying: it is how somebody works out
      // which switch turns it off.
      And('each tool says which plugin provided it', () =>
        expect(tools().every((entry) => entry.plugin.startsWith('@factory/'))).toBe(true),
      )
    })

    RuleScenario('The tools are beside the actions, not inside the workspace', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the task "Add due dates" exists with the workflow "hello"', () =>
        create('Add due dates', ['hello']),
      )
      When('I ask for the task', reload)
      Then('it has no workspace', () =>
        expect((response.body as { workspace?: unknown }).workspace).toBeUndefined(),
      )
      And('it still has tools', () => expect(tools().length).toBeGreaterThan(0))
    })

    RuleScenario('A terminal tool only changes directory', ({ Given, And, When, Then }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task', reload)
      Then('"open-terminal" would run "cd" to the workspace', () =>
        expect(tool('open-terminal')?.command).toBe(`cd ${join(root, 'work')}`),
      )
    })

    RuleScenario('A path with a space in it is quoted, not interpolated', ({
      Given,
      And,
      When,
      Then,
    }) => {
      let spaced = ''
      Given('the project "my work" exists at a directory with a space in its name', async () => {
        spaced = join(root, 'my work')
        mkdirSync(spaced, { recursive: true })
        await addProject('my work', spaced)
      })
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task', reload)
      // The one place argv has to become a shell string, and a path is the
      // half of it that comes from a person typing.
      Then('"open-terminal" quotes the directory', () =>
        expect(tool('open-terminal')?.command).toBe(`cd '${spaced}'`),
      )
    })

    RuleScenario("The session tool is the provider's own flag and the task's id", ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And(
        'the task "Check it" exists in it, with the session "s-99" on "claude"',
        givenSession('claude'),
      )
      When('I ask for the task', reload)
      Then('"open-session" would run "claude --resume s-99"', () =>
        expect(tool('open-session')?.command.endsWith('claude --resume s-99')).toBe(true),
      )
      And('"open-session" is available', () =>
        expect(tool('open-session')?.unavailable).toBeUndefined(),
      )
    })

    RuleScenario('A task no agent has run for is offered the session tool anyway', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task', reload)
      Then('"open-session" is offered', () => expect(tool('open-session')).toBeDefined())
      And('"open-session" is unavailable', () =>
        expect(tool('open-session')?.unavailable).toBeDefined(),
      )
      And('its reason mentions a session', () =>
        expect(tool('open-session')?.unavailable).toContain('session'),
      )
    })

    RuleScenario('A session whose provider is no longer installed names it', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And(
        'the task "Check it" exists in it, with the session "s-99" on "gone"',
        givenSession('gone'),
      )
      When('I ask for the task', reload)
      Then('"open-session" is unavailable', () =>
        expect(tool('open-session')?.unavailable).toBeDefined(),
      )
      And('its reason mentions "gone"', () =>
        expect(tool('open-session')?.unavailable).toContain('gone'),
      )
    })

    RuleScenario('Whether a tool can be performed is served, not guessed', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I ask for the task', reload)
      Then('"open-terminal" is not runnable', () =>
        expect(tool('open-terminal')?.runnable).toBe(false),
      )
      And('"diffity" is runnable', () => expect(tool('diffity')?.runnable).toBe(true))
    })
  })

  Rule('the route runs the tool that was named', ({ RuleScenario }) => {
    const givenProject = () => addProject('work', join(root, 'work'))
    const givenTask = async (): Promise<void> => {
      await call('POST', '/api/tasks', { name: 'Add due dates', projectId, workflows: ['hello'] })
      taskId = (response.body.task as { id: string }).id
    }
    const runTool = (id: string, body?: unknown) => () =>
      call('POST', `/api/tasks/${taskId}/tools/${id}`, body)

    RuleScenario('A terminal tool is handed to whatever can open one', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('something that can open a terminal is installed', givenTerminal(true))
      When('I run the tool "open-terminal"', runTool('open-terminal'))
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And('it was asked to open the workspace', () =>
        expect(opened?.cwd).toBe(join(root, 'work')),
      )
      And('it was asked to run nothing', () => expect(opened?.command).toBeUndefined())
    })

    RuleScenario('The session tool resumes by id', ({ Given, And, When, Then }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Check it" exists in it, with the session "s-99" on "claude"', async () => {
        await call('POST', '/api/tasks', { name: 'Check it', projectId, workflows: ['hello'] })
        taskId = (response.body.task as { id: string }).id
        service.tasks.rememberSession(taskId, { id: 's-99', provider: 'claude' })
      })
      And('something that can open a terminal is installed', givenTerminal(true))
      When('I run the tool "open-session"', runTool('open-session'))
      Then('it was asked to run "claude --resume s-99"', () =>
        expect(opened?.command).toEqual({ command: 'claude', args: ['--resume', 's-99'] }),
      )
    })

    RuleScenario('A detached tool is started by the daemon itself', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('"diffity" is installed', givenDiffity)
      When('I run the tool "diffity"', runTool('diffity'))
      Then('the response is 200', () => expect(response.statusCode).toBe(200))
      And('it reports a detached run', () => expect(response.body.ran).toBe('detached'))
      And('the detached launcher was asked to run diffity', () =>
        expect(launched?.command?.command).toContain('diffity'),
      )
    })

    RuleScenario('The client never says which directory', ({ Given, And, When, Then }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('something that can open a terminal is installed', givenTerminal(true))
      When('I run the tool "open-terminal" while asking for somewhere else', () =>
        call('POST', `/api/tasks/${taskId}/tools/open-terminal`, {
          cwd: '/etc',
          path: '/etc',
          command: { command: 'sh', args: ['-c', 'echo no'] },
        }),
      )
      Then('it was asked to open the workspace', () =>
        expect(opened?.cwd).toBe(join(root, 'work')),
      )
    })

    RuleScenario('A tool nobody registered is not found', ({ Given, And, When, Then }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I run the tool "nonsense"', runTool('nonsense'))
      Then('the response is 404', () => expect(response.statusCode).toBe(404))
    })

    RuleScenario('A tool that cannot be used here is refused with its own reason', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('something that can open a terminal is installed', givenTerminal(true))
      When('I run the tool "open-session"', runTool('open-session'))
      Then('the response is 409', () => expect(response.statusCode).toBe(409))
      And('the error mentions a session', () =>
        expect(String(response.body.error)).toContain('session'),
      )
      And('nothing was opened', () => expect(opened).toBeUndefined())
    })

    RuleScenario('A tool from a plugin switched off since the page loaded is refused', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('something that can open a terminal is installed', givenTerminal(true))
      // The route resolves tools the same way the page did, so the switch
      // bites at the door as well as in the list.
      And('the plugin providing "open-terminal" is switched off', () => {
        runtime.settings.update({ plugins: { disabled: ['@factory/task-terminal'] } })
      })
      When('I run the tool "open-terminal"', runTool('open-terminal'))
      Then('the response is 404', () => expect(response.statusCode).toBe(404))
      And('nothing was opened', () => expect(opened).toBeUndefined())
    })

    RuleScenario('A tool for a task that does not exist is not found', ({ When, Then }) => {
      When('I run a tool for a task that does not exist', () =>
        call('POST', '/api/tasks/nope/tools/open-terminal'),
      )
      Then('the response is 404', () => expect(response.statusCode).toBe(404))
    })
  })

  Rule('performing a terminal tool is a capability, and its absence is an answer', ({
    RuleScenario,
  }) => {
    const givenProject = () => addProject('work', join(root, 'work'))
    const givenTask = async (): Promise<void> => {
      await call('POST', '/api/tasks', { name: 'Add due dates', projectId, workflows: ['hello'] })
      taskId = (response.body.task as { id: string }).id
    }
    const runTool = (id: string) => () => call('POST', `/api/tasks/${taskId}/tools/${id}`)

    RuleScenario('With nothing installed the route hands back the command instead', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      When('I run the tool "open-terminal"', runTool('open-terminal'))
      Then('the response is 501', () => expect(response.statusCode).toBe(501))
      And('the response carries the command to run', () =>
        expect(response.body.command).toBe(`cd ${join(root, 'work')}`),
      )
    })

    RuleScenario('A terminal that will not open says why', ({ Given, And, When, Then }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('something that refuses to open a terminal is installed', givenTerminal(false))
      When('I run the tool "open-terminal"', runTool('open-terminal'))
      Then('the response is 500', () => expect(response.statusCode).toBe(500))
      And('the response explains why', () =>
        expect(String(response.body.error)).toContain('no terminal application'),
      )
    })

    RuleScenario('A detached tool that will not start says why', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given("the project \"work\" exists at the scope's directory", givenProject)
      And('the task "Add due dates" exists in it with the workflow "hello"', givenTask)
      And('"diffity" is installed', givenDiffity)
      And('starting something detached will fail', () => {
        detachedFails = true
      })
      When('I run the tool "diffity"', runTool('diffity'))
      Then('the response is 500', () => expect(response.statusCode).toBe(500))
      And('the response explains why', () =>
        expect(String(response.body.error)).toContain('would not start'),
      )
    })
  })

  Rule('a client chooses a task\'s name, never a path', ({ RuleScenario }) => {
    const createWithDirectory = (name: string, directory: string) => async (): Promise<void> => {
      await call('POST', '/api/tasks', { name, directory })
      taskId = (response.body.task as { id: string }).id
    }
    const directoryIs = (expected: string) => (): void => {
      expect((response.body.task as { directory: string }).directory).toBe(expected)
    }
    const oneSegment = (): void => {
      const directory = (response.body.task as { directory: string }).directory
      expect(directory).not.toContain('/')
      expect(directory).not.toContain('..')
    }

    RuleScenario('A directory sent by a client is slugged', ({ When, Then }) => {
      When(
        'I create the task "Add due dates" asking for the directory "Add Due Dates"',
        createWithDirectory('Add due dates', 'Add Due Dates'),
      )
      Then('the task\'s directory is "add-due-dates"', directoryIs('add-due-dates'))
    })

    RuleScenario("A directory sent by a client cannot climb out of the worktrees root", ({
      When,
      Then,
      And,
    }) => {
      When(
        'I create the task "Add due dates" asking for the directory "../../escape"',
        createWithDirectory('Add due dates', '../../escape'),
      )
      Then('the task\'s directory is "escape"', directoryIs('escape'))
      And("the task's directory is a single path segment", oneSegment)
    })

    RuleScenario('An absolute directory sent by a client cannot restart the path', ({
      When,
      Then,
      And,
    }) => {
      When(
        'I create the task "Add due dates" asking for the directory "/etc/passwd"',
        createWithDirectory('Add due dates', '/etc/passwd'),
      )
      Then('the task\'s directory is "etc-passwd"', directoryIs('etc-passwd'))
      And("the task's directory is a single path segment", oneSegment)
    })
  })
})
