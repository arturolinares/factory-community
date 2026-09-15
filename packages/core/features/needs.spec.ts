import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { needsOutOfOrder, resolveNeeds, type NeedsResolution } from '../src/task/needs.js'

const feature = await loadFeature(fileURLToPath(new URL('./needs.feature', import.meta.url)))

/** The five-stage pipeline this was built for, each naming only the one before. */
const PIPELINE: Record<string, string[]> = {
  analysis: [],
  design: ['analysis'],
  implement: ['design'],
  validate: ['implement'],
  verify: ['validate'],
}

describeFeature(feature, ({ Scenario, Rule, BeforeEachScenario }) => {
  let graph: Record<string, string[] | undefined>
  let result: NeedsResolution
  let order: ReturnType<typeof needsOutOfOrder>

  BeforeEachScenario(() => {
    graph = {}
    result = { order: [], added: [], problems: [] }
    order = []
  })

  const lookup = (name: string): readonly string[] | undefined => graph[name]
  const names = (list: string) => list.split(',').map((name) => name.trim())
  const ask = (list: string): void => {
    result = resolveNeeds(names(list), lookup)
  }
  const chain = (): void => {
    graph = { ...PIPELINE }
  }
  const errors = () => result.problems.filter((problem) => problem.severity === 'error')

  Scenario('A workflow with no needs is left exactly as it was', ({ Given, When, Then, And }) => {
    Given('"analysis" needs nothing', () => {
      graph = { analysis: [] }
    })
    When('I ask for "analysis"', () => ask('analysis'))
    Then('the list is "analysis"', () => expect(result.order).toEqual(['analysis']))
    And('nothing was added', () => expect(result.added).toEqual([]))
  })

  Scenario('Asking for the last one pulls in the whole chain', ({ Given, When, Then, And }) => {
    Given('the chain analysis, design, implement, validate, verify', chain)
    When('I ask for "verify"', () => ask('verify'))
    Then('the list is "analysis, design, implement, validate, verify"', () =>
      expect(result.order).toEqual(['analysis', 'design', 'implement', 'validate', 'verify']),
    )
    And('"analysis, design, implement, validate" were added', () =>
      expect(result.added).toEqual(['analysis', 'design', 'implement', 'validate']),
    )
  })

  Scenario('A predecessor always lands before the thing that needs it', ({
    Given,
    When,
    Then,
    And,
  }) => {
    Given('the chain analysis, design, implement, validate, verify', chain)
    When('I ask for "verify"', () => ask('verify'))
    const before = (first: string, second: string) =>
      expect(result.order.indexOf(first)).toBeLessThan(result.order.indexOf(second))
    Then('"analysis" comes before "design"', () => before('analysis', 'design'))
    And('"validate" comes before "verify"', () => before('validate', 'verify'))
  })

  Scenario('What is already there is not added twice', ({ Given, When, Then, And }) => {
    Given('the chain analysis, design, implement, validate, verify', chain)
    When('I ask for "implement, verify"', () => ask('implement, verify'))
    Then('the list is "analysis, design, implement, validate, verify"', () =>
      expect(result.order).toEqual(['analysis', 'design', 'implement', 'validate', 'verify']),
    )
    And('"implement" appears once', () =>
      expect(result.order.filter((name) => name === 'implement')).toHaveLength(1),
    )
  })

  Scenario('An entry already in the list is not moved', ({ Given, When, Then, And }) => {
    Given('the chain analysis, design, implement, validate, verify', chain)
    When('I ask for "analysis, verify"', () => ask('analysis, verify'))
    Then('the list is "analysis, design, implement, validate, verify"', () =>
      expect(result.order).toEqual(['analysis', 'design', 'implement', 'validate', 'verify']),
    )
    // The user's "it simply adds the ones that are missing": analysis was
    // already asked for, so it is not reported as something Factory chose.
    And('only "design, implement, validate" were added', () =>
      expect(result.added).toEqual(['design', 'implement', 'validate']),
    )
  })

  Scenario('Two dependents sharing a predecessor get one copy of it', ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('"left" needs "shared"', () => {
      graph['left'] = ['shared']
    })
    And('"right" needs "shared"', () => {
      graph['right'] = ['shared']
    })
    And('"shared" needs nothing', () => {
      graph['shared'] = []
    })
    When('I ask for "left, right"', () => ask('left, right'))
    Then('the list is "shared, left, right"', () =>
      expect(result.order).toEqual(['shared', 'left', 'right']),
    )
    And('"shared" appears once', () =>
      expect(result.order.filter((name) => name === 'shared')).toHaveLength(1),
    )
  })

  Rule('a ring is caught, not followed', ({ RuleScenario }) => {
    RuleScenario('A workflow that needs itself around a ring is reported', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('"a" needs "b"', () => {
        graph['a'] = ['b']
      })
      And('"b" needs "c"', () => {
        graph['b'] = ['c']
      })
      And('"c" needs "a"', () => {
        graph['c'] = ['a']
      })
      When('I ask for "a"', () => ask('a'))
      Then('it is refused as a cycle', () =>
        expect(errors().some((problem) => problem.rule === 'needs.cycle')).toBe(true),
      )
      And('the problem names the ring', () => {
        const message = errors().find((problem) => problem.rule === 'needs.cycle')?.message ?? ''
        for (const name of ['a', 'b', 'c']) expect(message).toContain(name)
      })
    })

    // The assertion that matters is that this scenario returns at all: without
    // the visiting set it recurses until the stack gives out.
    RuleScenario('A ring does not hang', ({ Given, And, When, Then }) => {
      Given('"a" needs "b"', () => {
        graph['a'] = ['b']
      })
      And('"b" needs "a"', () => {
        graph['b'] = ['a']
      })
      When('I ask for "a"', () => ask('a'))
      Then('it is refused as a cycle', () =>
        expect(errors().some((problem) => problem.rule === 'needs.cycle')).toBe(true),
      )
    })
  })

  Rule('a name that resolves to nothing is reported, and the rest still assembles', ({
    RuleScenario,
  }) => {
    const givenMissing = (): void => {
      graph = { design: ['analysis'] }
    }

    RuleScenario('An unknown predecessor is named', ({ Given, And, When, Then }) => {
      Given('"design" needs "analysis"', givenMissing)
      And('"analysis" does not exist', () => undefined)
      When('I ask for "design"', () => ask('design'))
      Then('a problem names "analysis" as missing', () => {
        const missing = errors().find((problem) => problem.rule === 'needs.missing')
        expect(missing?.message).toContain('analysis')
      })
    })

    RuleScenario('The rest of the list is still assembled', ({ Given, And, When, Then }) => {
      Given('"design" needs "analysis"', givenMissing)
      And('"analysis" does not exist', () => undefined)
      When('I ask for "design"', () => ask('design'))
      // A typo in something unrelated must not stop the list being built.
      Then('the list still contains "design"', () => expect(result.order).toContain('design'))
    })
  })

  Rule('a list can be checked without being repaired', ({ RuleScenario }) => {
    const check = (list: string): void => {
      order = needsOutOfOrder(names(list), lookup)
    }

    RuleScenario('A predecessor that comes after its dependent is out of order', ({
      Given,
      When,
      Then,
    }) => {
      Given('the chain analysis, design, implement, validate, verify', chain)
      When('I check the order of "verify, validate"', () => check('verify, validate'))
      Then('"verify" is reported as needing "validate" later in the list', () =>
        expect(order).toContainEqual({ workflow: 'verify', missing: 'validate', late: true }),
      )
    })

    RuleScenario('A predecessor that is absent entirely is reported too', ({
      Given,
      When,
      Then,
    }) => {
      Given('the chain analysis, design, implement, validate, verify', chain)
      When('I check the order of "verify"', () => check('verify'))
      Then('"verify" is reported as missing "validate"', () =>
        expect(order).toContainEqual({ workflow: 'verify', missing: 'validate', late: false }),
      )
    })

    RuleScenario('A correctly ordered list reports nothing', ({ Given, When, Then }) => {
      Given('the chain analysis, design, implement, validate, verify', chain)
      When('I check the order of "analysis, design, implement, validate, verify"', () =>
        check('analysis, design, implement, validate, verify'),
      )
      Then('nothing is out of order', () => expect(order).toEqual([]))
    })
  })

  Rule('a duplicate the person asked for is kept', ({ RuleScenario }) => {
    RuleScenario('The same workflow asked for twice stays twice', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('"hello" needs nothing', () => {
        graph = { hello: [] }
      })
      When('I ask for "hello, hello"', () => ask('hello, hello'))
      Then('the list is "hello, hello"', () => expect(result.order).toEqual(['hello', 'hello']))
      And('nothing was added', () => expect(result.added).toEqual([]))
    })

    RuleScenario('A shared predecessor is still added only once', ({ Given, When, Then, And }) => {
      Given('the chain analysis, design, implement, validate, verify', chain)
      When('I ask for "verify, verify"', () => ask('verify, verify'))
      Then('"verify" appears twice', () =>
        expect(result.order.filter((name) => name === 'verify')).toHaveLength(2),
      )
      And('"validate" appears once', () =>
        expect(result.order.filter((name) => name === 'validate')).toHaveLength(1),
      )
    })
  })
})
