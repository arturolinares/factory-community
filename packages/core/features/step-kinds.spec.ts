import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { EventBus } from '@factory/events'
import { CapabilityHost, type FactoryPlugin } from '../src/host.js'
import { builtinStepsPlugin } from '../src/builtins/steps.js'
import { STEP_KIND, defineStepKind, type Step } from '../src/schema/step.js'
import { closedWithExtensions } from '../src/schema/common.js'
import { parsePhase, type Phase } from '../src/schema/phase.js'
import type { Problem } from '../src/problems.js'

const feature = await loadFeature(fileURLToPath(new URL('./step-kinds.feature', import.meta.url)))

/**
 * A stand-in for a third-party plugin. It touches nothing in core beyond the
 * public contract -- which is the whole assertion of this feature.
 */
const httpPlugin: FactoryPlugin = {
  name: 'acme-http',
  version: '1.0.0',
  register(context) {
    context.provide(
      STEP_KIND,
      defineStepKind({
        id: 'http',
        summary: 'Makes an HTTP request.',
        schema: closedWithExtensions({
          url: z.string().min(1, 'url is required'),
          method: z.string().optional(),
        }),
        sugarKey: 'url',
      }),
    )
  },
}

describeFeature(feature, ({ Background, Rule, Scenario, BeforeEachScenario }) => {
  let host: CapabilityHost
  let input: unknown
  let phase: Phase | undefined
  let problems: readonly Problem[]

  const errors = () => problems.filter((p) => p.severity === 'error')
  const anyMessage = (needle: string) =>
    problems.some((p) => p.message.toLowerCase().includes(needle.toLowerCase()))
  const step = (index: number): Step | undefined => phase?.steps[index]

  BeforeEachScenario(() => {
    input = undefined
    phase = undefined
    problems = []
  })

  // The host is built here rather than in BeforeEachScenario: the runner runs
  // Background steps before it, so a host created there would be replaced and
  // the built-ins would silently vanish.
  Background(({ Given }) => {
    Given('the built-in step kinds are registered', async () => {
      host = new CapabilityHost({ events: new EventBus({ onSubscriberError: () => {} }) })
      await host.load(builtinStepsPlugin)
    })
  })

  const givenPhase = (_ctx: unknown, docstring: string) => {
    input = parseYaml(docstring)
  }
  const givenHttpPlugin = async () => {
    await host.load(httpPlugin)
  }
  const whenParsed = () => {
    const result = parsePhase(input, host)
    phase = result.phase
    problems = result.problems
  }

  Scenario('The shorthand needs no "uses:"', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toHaveLength(0))
    And('step 0 uses "shell"', () => expect(step(0)?.uses).toBe('shell'))
    And('step 0 runs "npm test"', () => expect(step(0)?.run).toBe('npm test'))
  })

  Scenario('Naming the kind explicitly is equivalent', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toHaveLength(0))
    And('step 0 uses "shell"', () => expect(step(0)?.uses).toBe('shell'))
    And('step 0 runs "npm test"', () => expect(step(0)?.run).toBe('npm test'))
  })

  Scenario('An unknown step kind is rejected and says what is installed', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing fails', () => expect(phase).toBeUndefined())
    And('a problem mentions "Unknown step kind"', () =>
      expect(anyMessage('unknown step kind')).toBe(true),
    )
    And('a problem lists the installed kinds', () => expect(anyMessage('agent, shell')).toBe(true))
  })

  Scenario('A step naming no kind at all is rejected', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing fails', () => expect(phase).toBeUndefined())
    And('a problem mentions "uses:"', () => expect(anyMessage('uses:')).toBe(true))
  })

  Scenario(
    'A plugin adds a step kind and phases can use it, with no core change',
    ({ Given, And, When, Then }) => {
      Given('a plugin registers a "http" step kind requiring a "url"', givenHttpPlugin)
      And('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing succeeds', () => expect(errors()).toHaveLength(0))
      And('step 0 uses "http"', () => expect(step(0)?.uses).toBe('http'))
    },
  )

  Scenario("A plugin's step kind validates its own fields", ({ Given, And, When, Then }) => {
    Given('a plugin registers a "http" step kind requiring a "url"', givenHttpPlugin)
    And('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing fails', () => expect(phase).toBeUndefined())
    And('a problem names the field "steps.0.url"', () =>
      expect(errors().some((p) => p.field === 'steps.0.url')).toBe(true),
    )
  })

  Scenario('A plugin can bring its own shorthand', ({ Given, And, When, Then }) => {
    Given('a plugin registers a "http" step kind requiring a "url"', givenHttpPlugin)
    And('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toHaveLength(0))
    And('step 0 uses "http"', () => expect(step(0)?.uses).toBe('http'))
  })

  Scenario('Extension fields on a step are preserved', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toHaveLength(0))
    And('step 0 keeps the extension "x-timeout"', () => expect(step(0)?.['x-timeout']).toBe(60))
  })

  Scenario('An agent step keeps its provider, model and session', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toHaveLength(0))
    And('step 0 uses "agent"', () => expect(step(0)?.uses).toBe('agent'))
    And('step 0 has provider "claude"', () => expect(step(0)?.provider).toBe('claude'))
    And('step 0 has model "strong"', () => expect(step(0)?.model).toBe('strong'))
    And('step 0 has session "workflow"', () => expect(step(0)?.session).toBe('workflow'))
  })

  Scenario('Retries are a field of every kind, not of any one kind', ({
    Given,
    When,
    Then,
    And,
  }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toEqual([]))
    // Core takes these out before the kind's own schema — which is closed —
    // ever sees them, so no plugin has to reimplement retrying to be retryable.
    And('step 0 retries 2 times', () => expect(step(0)?.retries).toBe(2))
    And('step 0 waits 5 seconds between attempts', () =>
      expect(step(0)?.retry_delay).toBe(5),
    )
  })

  Scenario("A plugin's kind is retryable without knowing what a retry is", ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('a plugin providing the "http" kind', givenHttpPlugin)
    And('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing succeeds', () => expect(errors()).toEqual([]))
    And('step 0 retries 1 times', () => expect(step(0)?.retries).toBe(1))
  })

  Scenario('Retries must be a number of attempts', ({ Given, When, Then, And }) => {
    Given('the phase YAML:', givenPhase)
    When('the phase is parsed', whenParsed)
    Then('parsing fails', () => expect(errors().length).toBeGreaterThan(0))
    And('a problem names the field "retries"', () =>
      expect(problems.some((problem) => (problem.field ?? '').includes('retries'))).toBe(true),
    )
  })

  Rule('an agent step may name an agent instead of spelling one out', ({ RuleScenario }) => {
    const namesAgent = (index: number) => (step(index) as { agent?: string } | undefined)?.agent

    RuleScenario('"agent:" alone is shorthand for an agent step', ({ Given, When, Then, And }) => {
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing succeeds', () => expect(errors()).toEqual([]))
      And('step 0 uses "agent"', () => expect(step(0)?.uses).toBe('agent'))
      And('step 0 names the agent "developer"', () => expect(namesAgent(0)).toBe('developer'))
    })

    RuleScenario('A step that spells it out still works', ({ Given, When, Then, And }) => {
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing succeeds', () => expect(errors()).toEqual([]))
      And('step 0 uses "agent"', () => expect(step(0)?.uses).toBe('agent'))
    })

    RuleScenario('A step may name an agent and still override one setting', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing succeeds', () => expect(errors()).toEqual([]))
      And('step 0 names the agent "developer"', () => expect(namesAgent(0)).toBe('developer'))
    })
  })

  Rule('an artifact is a name, not a path', ({ RuleScenario }) => {
    const promises = (index: number) =>
      (step(index) as { artifact?: string } | undefined)?.artifact

    RuleScenario('An agent step names the document it will write', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing succeeds', () => expect(errors()).toEqual([]))
      And('step 0 promises the artifact "analysis"', () => expect(promises(0)).toBe('analysis'))
    })

    RuleScenario('A filename is not a name', ({ Given, When, Then, And }) => {
      // `.md` is not optional, so saying it is either redundant or a lie about
      // where the file goes. Either way it is worth a named error.
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing fails', () => expect(errors().length).toBeGreaterThan(0))
      And('a problem mentions "artifact"', () => expect(anyMessage('artifact')).toBe(true))
    })

    RuleScenario('A path is certainly not a name', ({ Given, When, Then }) => {
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing fails', () => expect(errors().length).toBeGreaterThan(0))
    })

    RuleScenario('A shell step cannot promise one', ({ Given, When, Then, And }) => {
      // Only an agent step can be *told* where to write, and an artifact nobody
      // was told about is the promise this whole change exists to keep.
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing fails', () => expect(errors().length).toBeGreaterThan(0))
      And('a problem mentions "artifact"', () => expect(anyMessage('artifact')).toBe(true))
    })
  })

  Rule('a step does not decide where it runs', ({ RuleScenario }) => {
    // The field was accepted, documented and rendered in the builder, and no
    // code ever read it. Refusing it is the honest answer: where a step runs is
    // the phase's and the project's business.
    RuleScenario('A shell step cannot set its own working directory', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the phase YAML:', givenPhase)
      When('the phase is parsed', whenParsed)
      Then('parsing fails', () => expect(errors().length).toBeGreaterThan(0))
      And('a problem mentions "working_dir"', () => expect(anyMessage('working_dir')).toBe(true))
    })
  })
})
