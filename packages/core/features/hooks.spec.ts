import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { HookRegistry, keep, reject, type DefinitionWrite } from '../src/hooks.js'
import type { Problem } from '../src/problems.js'

const feature = await loadFeature(fileURLToPath(new URL('./hooks.feature', import.meta.url)))

const problems = (count: number, from: string): Problem[] =>
  Array.from({ length: count }, (_, index) => ({
    severity: 'error' as const,
    message: `${from} problem ${index + 1}`,
  }))

const write = (name: string): DefinitionWrite => ({
  kind: 'workflow',
  name,
  definition: {},
  scope: 'project',
  file: `/tmp/.factory/workflows/${name}.workflow.yaml`,
})

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let hooks: HookRegistry
  let collected: Problem[]
  let outcome: Awaited<ReturnType<HookRegistry['transform']>>
  let laterHookRan: boolean

  BeforeEachScenario(() => {
    hooks = new HookRegistry()
    collected = []
    laterHookRan = false
    outcome = keep(write('original'))
  })

  Scenario('Every collect hook runs and the results are concatenated', ({ Given, And, When, Then }) => {
    Given('a "validateDefinition" hook from "linter-a" reporting 1 problem', () => {
      hooks.add('validateDefinition', 'linter-a', () => problems(1, 'linter-a'))
    })
    And('a "validateDefinition" hook from "linter-b" reporting 2 problems', () => {
      hooks.add('validateDefinition', 'linter-b', () => problems(2, 'linter-b'))
    })
    When('a definition is validated', async () => {
      collected = await hooks.collect('validateDefinition', {
        kind: 'workflow',
        name: 'development',
        definition: {},
      })
    })
    Then('3 problems are collected', () => {
      expect(collected).toHaveLength(3)
    })
  })

  Scenario('A collect hook that throws does not hide the other results', ({ Given, And, When, Then }) => {
    Given('a "validateDefinition" hook from "broken" that throws', () => {
      hooks.add('validateDefinition', 'broken', () => {
        throw new Error('plugin is broken')
      })
    })
    And('a "validateDefinition" hook from "linter-b" reporting 2 problems', () => {
      hooks.add('validateDefinition', 'linter-b', () => problems(2, 'linter-b'))
    })
    When('a definition is validated', async () => {
      collected = await hooks.collect('validateDefinition', {
        kind: 'workflow',
        name: 'development',
        definition: {},
      })
    })
    Then('3 problems are collected', () => {
      expect(collected).toHaveLength(3)
    })
    And('one problem names the hook that threw', () => {
      expect(collected.some((p) => p.message.includes('broken'))).toBe(true)
    })
  })

  Scenario('Transform hooks are chained in registration order', ({ Given, And, When, Then }) => {
    Given('a "beforeDefinitionWrite" hook from "first" that renames the definition to "one"', () => {
      hooks.add('beforeDefinitionWrite', 'first', (value) => keep({ ...value, name: 'one' }))
    })
    And('a "beforeDefinitionWrite" hook from "second" that appends "-two" to the name', () => {
      hooks.add('beforeDefinitionWrite', 'second', (value) =>
        keep({ ...value, name: `${value.name}-two` }),
      )
    })
    When('a definition is written', async () => {
      outcome = await hooks.transform('beforeDefinitionWrite', write('original'))
    })
    Then('the write continues', () => {
      expect(outcome.action).toBe('continue')
    })
    And('the definition name is "one-two"', () => {
      expect(outcome.action === 'continue' && outcome.value.name).toBe('one-two')
    })
  })

  Scenario('A rejection stops the chain', ({ Given, And, When, Then }) => {
    Given('a "beforeDefinitionWrite" hook from "policy" that rejects', () => {
      hooks.add('beforeDefinitionWrite', 'policy', () =>
        reject({ severity: 'error', message: 'policy forbids this workflow' }),
      )
    })
    And(
      'a "beforeDefinitionWrite" hook from "later" that renames the definition to "unreachable"',
      () => {
        hooks.add('beforeDefinitionWrite', 'later', (value) => {
          laterHookRan = true
          return keep({ ...value, name: 'unreachable' })
        })
      },
    )
    When('a definition is written', async () => {
      outcome = await hooks.transform('beforeDefinitionWrite', write('original'))
    })
    Then('the write is rejected', () => {
      expect(outcome.action).toBe('reject')
    })
    And('the later hook did not run', () => {
      expect(laterHookRan).toBe(false)
    })
  })

  Scenario('A transform hook that throws rejects the write', ({ Given, When, Then, And }) => {
    Given('a "beforeDefinitionWrite" hook from "broken" that throws', () => {
      hooks.add('beforeDefinitionWrite', 'broken', () => {
        throw new Error('plugin is broken')
      })
    })
    When('a definition is written', async () => {
      outcome = await hooks.transform('beforeDefinitionWrite', write('original'))
    })
    Then('the write is rejected', () => {
      expect(outcome.action).toBe('reject')
    })
    And('the rejection names the hook that threw', () => {
      expect(outcome.action === 'reject' && outcome.problems[0]?.message).toContain('broken')
    })
  })

  Scenario('With no hooks registered the value passes through unchanged', ({ Given, When, Then, And }) => {
    Given('no hooks are registered', () => {
      expect(hooks.count('beforeDefinitionWrite')).toBe(0)
    })
    When('a definition is written', async () => {
      outcome = await hooks.transform('beforeDefinitionWrite', write('original'))
    })
    Then('the write continues', () => {
      expect(outcome.action).toBe('continue')
    })
    And('the definition name is "original"', () => {
      expect(outcome.action === 'continue' && outcome.value.name).toBe('original')
    })
  })

  Scenario('Hook contributors are reported', ({ Given, And, Then }) => {
    Given('a "validateDefinition" hook from "linter-a" reporting 1 problem', () => {
      hooks.add('validateDefinition', 'linter-a', () => problems(1, 'linter-a'))
    })
    And('a "validateDefinition" hook from "linter-b" reporting 2 problems', () => {
      hooks.add('validateDefinition', 'linter-b', () => problems(2, 'linter-b'))
    })
    Then('the contributors to "validateDefinition" are "linter-a" and "linter-b"', () => {
      expect(hooks.contributors('validateDefinition')).toEqual(['linter-a', 'linter-b'])
    })
  })
})
