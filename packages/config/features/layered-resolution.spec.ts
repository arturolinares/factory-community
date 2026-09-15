import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { EventBus } from '@factory/events'
import {
  CapabilityHost,
  builtinStepsPlugin,
  parseWorkflowFile,
  type Agent,
  type Phase,
  type Workflow,
} from '@factory/core'
import { Sandbox } from './support.js'
import { resolveScopes, type ScopeChain } from '../src/scopes.js'
import {
  explain,
  listDefinitions,
  resolveAgent,
  resolvePhase,
  resolveWorkflow,
  type Candidate,
  type DefinitionListing,
  type ResolvedDefinition,
} from '../src/store.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./layered-resolution.feature', import.meta.url)),
)

const WORKFLOW = 'name: development\nphases: [analysis]\n'
const PHASE = 'name: analysis\nsteps: [{run: npm test}]\n'

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  let box: Sandbox
  let host: CapabilityHost
  let env: Record<string, string | undefined>
  let cwd = ''
  let chain: ScopeChain
  let resolved: ResolvedDefinition<Workflow> | undefined
  let resolvedPhase: ResolvedDefinition<Phase> | undefined
  let resolvedAgent: ResolvedDefinition<Agent> | undefined
  let candidates: Candidate[] = []
  let listing: DefinitionListing[] = []

  BeforeEachScenario(async () => {
    box = new Sandbox()
    host = new CapabilityHost({ events: new EventBus({ onSubscriberError: () => {} }) })
    await host.load(builtinStepsPlugin)
    // Both scopes exist up front so precedence is about content, not existence.
    box.scope('home', 'user')
    box.scope('work')
    env = { FACTORY_HOME: box.scope('home', 'user') }
    cwd = box.dir('work', 'src')
    resolved = undefined
    resolvedPhase = undefined
    resolvedAgent = undefined
    candidates = []
    listing = []
  })
  AfterEachScenario(() => box.cleanup())

  const userScope = () => box.scope('home', 'user')
  const projectScope = () => box.scope('work')
  const build = () => {
    chain = resolveScopes({ cwd, env })
  }
  const parse = (text: string, file: string) => {
    const r = parseWorkflowFile(text, file)
    return { value: r.value, problems: r.problems }
  }

  Scenario('The project copy wins and the user copy is reported as shadowed', ({ Given, And, When, Then }) => {
    Given('the user scope defines the workflow "development"', () => {
      box.workflow(userScope(), 'development', WORKFLOW)
    })
    And('the project scope defines the workflow "development"', () => {
      box.workflow(projectScope(), 'development', WORKFLOW)
    })
    When('the workflow "development" is resolved', () => {
      build()
      resolved = resolveWorkflow(chain, 'development')
    })
    Then('it comes from the "project" scope', () => expect(resolved?.ref.scope).toBe('project'))
    And('it shadows 1 definition', () => expect(resolved?.shadows).toHaveLength(1))
    And('the shadowed definition is in the "user" scope', () =>
      expect(resolved?.shadows[0]?.scope).toBe('user'),
    )
  })

  Scenario('Resolution falls through to the user scope', ({ Given, When, Then, And }) => {
    Given('the user scope defines the workflow "development"', () => {
      box.workflow(userScope(), 'development', WORKFLOW)
    })
    When('the workflow "development" is resolved', () => {
      build()
      resolved = resolveWorkflow(chain, 'development')
    })
    Then('it comes from the "user" scope', () => expect(resolved?.ref.scope).toBe('user'))
    And('it shadows 0 definitions', () => expect(resolved?.shadows).toHaveLength(0))
  })

  Scenario('Resolution is per name, not per scope', ({ Given, And, When, Then }) => {
    Given('the user scope defines the workflow "development"', () => {
      box.workflow(userScope(), 'development', WORKFLOW)
    })
    And('the project scope defines the workflow "release"', () => {
      box.workflow(projectScope(), 'release', 'name: release\nphases: []\n')
    })
    When('the workflows are listed', () => {
      build()
      listing = listDefinitions(chain, 'workflow', parse)
    })
    Then('"development" resolves from the "user" scope', () =>
      expect(listing.find((e) => e.name === 'development')?.winner.scope).toBe('user'),
    )
    And('"release" resolves from the "project" scope', () =>
      expect(listing.find((e) => e.name === 'release')?.winner.scope).toBe('project'),
    )
  })

  Scenario('A name that exists nowhere resolves to nothing', ({ When, Then }) => {
    When('the workflow "missing" is resolved', () => {
      build()
      resolved = resolveWorkflow(chain, 'missing')
    })
    Then('nothing is found', () => expect(resolved).toBeUndefined())
  })

  Scenario('Explaining a resolution lists every path tried', ({ Given, When, Then, And }) => {
    Given('the user scope defines the workflow "development"', () => {
      box.workflow(userScope(), 'development', WORKFLOW)
    })
    When('the workflow "development" is explained', () => {
      build()
      candidates = explain(chain, 'workflow', 'development')
    })
    Then('3 candidates are listed', () => expect(candidates).toHaveLength(3))
    And('the candidates are in order "project, user, builtin"', () =>
      expect(candidates.map((c) => c.scope).join(', ')).toBe('project, user, builtin'),
    )
    And('the "user" candidate exists', () =>
      expect(candidates.find((c) => c.scope === 'user')?.exists).toBe(true),
    )
    And('the "project" candidate does not exist', () =>
      expect(candidates.find((c) => c.scope === 'project')?.exists).toBe(false),
    )
  })

  Scenario('A file that fails to parse still wins', ({ Given, And, When, Then }) => {
    Given('the user scope defines the workflow "development"', () => {
      box.workflow(userScope(), 'development', WORKFLOW)
    })
    And('the project scope defines a broken workflow "development"', () => {
      box.workflow(projectScope(), 'development', 'name: development\nmode: banana\n')
    })
    When('the workflow "development" is resolved', () => {
      build()
      resolved = resolveWorkflow(chain, 'development')
    })
    Then('it comes from the "project" scope', () => expect(resolved?.ref.scope).toBe('project'))
    And('it has problems', () => expect(resolved?.problems.length).toBeGreaterThan(0))
    And('no value is produced', () => expect(resolved?.value).toBeUndefined())
  })

  Scenario('Listing marks every shadowed copy', ({ Given, And, When, Then }) => {
    Given('the user scope defines the workflow "development"', () => {
      box.workflow(userScope(), 'development', WORKFLOW)
    })
    And('the project scope defines the workflow "development"', () => {
      box.workflow(projectScope(), 'development', WORKFLOW)
    })
    When('the workflows are listed', () => {
      build()
      listing = listDefinitions(chain, 'workflow', parse)
    })
    // Counting every workflow would couple this to whatever ships built-in, so
    // assert the deduplication of the name under test instead.
    Then('"development" is listed exactly once', () =>
      expect(listing.filter((e) => e.name === 'development')).toHaveLength(1),
    )
    And('"development" is shadowed once', () =>
      expect(listing.find((e) => e.name === 'development')?.shadowed).toHaveLength(1),
    )
  })

  Scenario('A phase resolves through the same chain', ({ Given, When, Then, And }) => {
    Given('the project scope defines the phase "analysis"', () => {
      box.phase(projectScope(), 'analysis', PHASE)
    })
    When('the phase "analysis" is resolved', () => {
      build()
      resolvedPhase = resolvePhase(chain, host, 'analysis')
    })
    Then('it comes from the "project" scope', () => expect(resolvedPhase?.ref.scope).toBe('project'))
    And('the phase has 1 step', () => expect(resolvedPhase?.value.steps).toHaveLength(1))
  })

  /**
   * Agents resolve through the same machinery, which is the point of adding a
   * kind rather than a bespoke store: shadowing, `explain` and listing all
   * work without being written again.
   */
  const AGENT = 'name: developer\nprovider: claude\nmodel: strong\n'

  Scenario('An agent resolves through the same chain', ({ Given, When, Then, And }) => {
    Given('the project scope defines the agent "developer"', () => {
      box.agent(projectScope(), 'developer', AGENT)
    })
    When('the agent "developer" is resolved', () => {
      build()
      resolvedAgent = resolveAgent(chain, 'developer')
    })
    Then('it comes from the "project" scope', () => expect(resolvedAgent?.ref.scope).toBe('project'))
    And('the agent uses the "claude" provider', () =>
      expect(resolvedAgent?.value.provider).toBe('claude'),
    )
  })

  Scenario("A project's agent shadows the user's", ({ Given, And, When, Then }) => {
    Given('the user scope defines the agent "developer" using codex', () => {
      box.agent(userScope(), 'developer', 'name: developer\nprovider: codex\n')
    })
    And('the project scope defines the agent "developer"', () => {
      box.agent(projectScope(), 'developer', AGENT)
    })
    When('the agent "developer" is resolved', () => {
      build()
      resolvedAgent = resolveAgent(chain, 'developer')
    })
    Then('it comes from the "project" scope', () => expect(resolvedAgent?.ref.scope).toBe('project'))
    And('the agent uses the "claude" provider', () =>
      expect(resolvedAgent?.value.provider).toBe('claude'),
    )
  })

  Scenario('The built-in workflow is found when nothing shadows it', ({ Given, When, Then }) => {
    Given('a chain that includes the built-in scope', build)
    When('the workflow "hello-world" is resolved', () => {
      resolved = resolveWorkflow(chain, 'hello-world')
    })
    Then('it comes from the "builtin" scope', () => expect(resolved?.ref.scope).toBe('builtin'))
  })
})
