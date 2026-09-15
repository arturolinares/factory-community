import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { EventBus } from '@factory/events'
import { CapabilityHost } from '../src/host.js'
import { builtinStepsPlugin } from '../src/builtins/steps.js'
import { parsePhaseFile, parseWorkflowFile } from '../src/yaml/parse.js'
import type { Problem } from '../src/problems.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./located-errors.feature', import.meta.url)),
)

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let host: CapabilityHost
  let source = ''
  let problems: readonly Problem[] = []
  let parsed = false

  BeforeEachScenario(async () => {
    host = new CapabilityHost({ events: new EventBus({ onSubscriberError: () => {} }) })
    await host.load(builtinStepsPlugin)
    source = ''
    problems = []
    parsed = false
  })

  const capture = (_ctx: unknown, docstring: string) => {
    source = docstring + '\n'
  }
  const onLine = (line: number) => problems.some((p) => p.at?.line === line)

  Scenario('A YAML syntax error is reported with its position', ({ Given, When, Then, And }) => {
    Given('the workflow file:', capture)
    When('the file is parsed', () => {
      const r = parseWorkflowFile(source, 'development.workflow.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('a problem carries a position', () =>
      expect(problems.some((p) => p.at !== undefined)).toBe(true),
    )
    And('a problem names the file', () =>
      expect(problems.some((p) => p.file === 'development.workflow.yaml')).toBe(true),
    )
    And('the problem rule is "yaml.syntax"', () =>
      expect(problems.some((p) => p.rule === 'yaml.syntax')).toBe(true),
    )
  })

  Scenario('An invalid value points at the line that holds it', ({ Given, When, Then, And }) => {
    Given('the workflow file:', capture)
    When('the file is parsed', () => {
      const r = parseWorkflowFile(source, 'development.workflow.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('a problem is on line 3', () => expect(onLine(3)).toBe(true))
    And('a problem names the field "mode"', () =>
      expect(problems.some((p) => p.field === 'mode')).toBe(true),
    )
  })

  Scenario('An unknown field points at the offending key', ({ Given, When, Then, And }) => {
    Given('the workflow file:', capture)
    When('the file is parsed', () => {
      const r = parseWorkflowFile(source, 'development.workflow.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('a problem is on line 3', () => expect(onLine(3)).toBe(true))
  })

  Scenario('A problem inside a step points into the step', ({ Given, When, Then, And }) => {
    Given('the phase file:', capture)
    When('the phase file is parsed', () => {
      const r = parsePhaseFile(source, host, 'analysis.phase.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('a problem is on line 3', () => expect(onLine(3)).toBe(true))
    And('a problem names the field "steps.0.prompt"', () =>
      expect(problems.some((p) => p.field === 'steps.0.prompt')).toBe(true),
    )
  })

  Scenario('A missing required field is reported against the file', ({ Given, When, Then, And }) => {
    Given('the workflow file:', capture)
    When('the file is parsed', () => {
      const r = parseWorkflowFile(source, 'development.workflow.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('a problem names the field "name"', () =>
      expect(problems.some((p) => p.field === 'name')).toBe(true),
    )
  })

  Scenario('A value YAML read as a number explains how to keep it text', ({ Given, When, Then, And }) => {
    Given('the phase file:', capture)
    When('the phase file is parsed', () => {
      const r = parsePhaseFile(source, host, 'build.phase.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('a problem suggests quoting the value', () =>
      expect(problems.some((p) => p.message.includes('quotes'))).toBe(true),
    )
  })

  Scenario('A file that is not a mapping is rejected clearly', ({ Given, When, Then, And }) => {
    Given('the workflow file:', capture)
    When('the file is parsed', () => {
      const r = parseWorkflowFile(source, 'development.workflow.yaml')
      problems = r.problems
      parsed = r.value !== undefined
    })
    Then('parsing fails', () => expect(parsed).toBe(false))
    And('the problem rule is "yaml.notAMapping"', () =>
      expect(problems.some((p) => p.rule === 'yaml.notAMapping')).toBe(true),
    )
  })
})
