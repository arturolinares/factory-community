import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  EXECUTION_PROFILE_LABELS,
  EXECUTION_PROFILES,
  isConfined,
  isExecutionProfile,
  resolveProfile,
  type ExecutionProfile,
} from '../src/security/profile.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./execution-profiles.feature', import.meta.url)),
)

describeFeature(feature, ({ Scenario, Rule, BeforeEachScenario }) => {
  let project: ExecutionProfile | undefined
  let installation: ExecutionProfile | undefined
  let resolved: ExecutionProfile | undefined
  let checked: boolean[]
  let labels: string[]

  BeforeEachScenario(() => {
    project = undefined
    installation = undefined
    resolved = undefined
    checked = []
    labels = []
  })

  const projectStatesNothing = (): void => {
    project = undefined
  }
  const installationStatesNothing = (): void => {
    installation = undefined
  }
  const projectChose =
    (profile: ExecutionProfile) =>
    (): void => {
      project = profile
    }
  const installationChose =
    (profile: ExecutionProfile) =>
    (): void => {
      installation = profile
    }
  const ask = (): void => {
    resolved = resolveProfile({ project, installation })
  }
  const profileIs = (expected: string) => (): void => {
    expect(resolved).toBe(expected)
  }
  const confined = (yes: boolean) => (): void => {
    expect(isConfined(resolved as ExecutionProfile)).toBe(yes)
  }

  Scenario('An installation that has said nothing is confined', ({ Given, And, When, Then }) => {
    Given('a project that states no profile', projectStatesNothing)
    And('an installation that states no profile', installationStatesNothing)
    When('I ask which profile applies', ask)
    Then('the profile is "default"', profileIs('default'))
    And('the agent is confined', confined(true))
  })

  Scenario("The installation's choice applies to a project that states none", ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('a project that states no profile', projectStatesNothing)
    And('the installation chose "full-access"', installationChose('full-access'))
    When('I ask which profile applies', ask)
    Then('the profile is "full-access"', profileIs('full-access'))
    And('the agent is not confined', confined(false))
  })

  Scenario('A project overrides the installation', ({ Given, And, When, Then }) => {
    Given('the project chose "default"', projectChose('default'))
    And('the installation chose "full-access"', installationChose('full-access'))
    When('I ask which profile applies', ask)
    Then('the profile is "default"', profileIs('default'))
  })

  Scenario('A project can be less confined than its installation', ({ Given, And, When, Then }) => {
    Given('the project chose "full-access"', projectChose('full-access'))
    And('the installation chose "default"', installationChose('default'))
    When('I ask which profile applies', ask)
    Then('the profile is "full-access"', profileIs('full-access'))
  })

  Rule('absence means "not stated", never a third answer', ({ RuleScenario }) => {
    RuleScenario('A project that states nothing follows the installation later', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a project that states no profile', projectStatesNothing)
      And('the installation chose "full-access"', installationChose('full-access'))
      When('I ask which profile applies', ask)
      Then('the profile is "full-access"', profileIs('full-access'))
    })

    RuleScenario('Stating the same thing as the installation is still a decision', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the project chose "full-access"', projectChose('full-access'))
      And('the installation chose "full-access"', installationChose('full-access'))
      When('I ask which profile applies', ask)
      Then('the profile is "full-access"', profileIs('full-access'))
    })
  })

  Rule('a profile arriving from outside is checked before it is stored', ({ RuleScenario }) => {
    RuleScenario('The two profiles are recognised', ({ When, Then }) => {
      When('I check "default" and "full-access"', () => {
        checked = [isExecutionProfile('default'), isExecutionProfile('full-access')]
      })
      Then('both are profiles', () => {
        expect(checked).toEqual([true, true])
      })
    })

    RuleScenario('Anything else is not a profile', ({ When, Then }) => {
      When('I check "Default", "full access", "none", "" and nothing at all', () => {
        checked = [
          isExecutionProfile('Default'),
          isExecutionProfile('full access'),
          isExecutionProfile('none'),
          isExecutionProfile(''),
          isExecutionProfile(undefined),
        ]
      })
      Then('none of them is a profile', () => {
        expect(checked).toEqual([false, false, false, false, false])
      })
    })
  })

  Rule('each profile has one name for a person', ({ RuleScenario }) => {
    RuleScenario('Both profiles have a label', ({ When, Then, And }) => {
      When('I ask what to call each profile', () => {
        // Every profile, not the two named below: a third one added without a
        // label would reach the board as `undefined`.
        labels = EXECUTION_PROFILES.map((profile) => EXECUTION_PROFILE_LABELS[profile])
      })
      Then('"default" is called "Default"', () => {
        expect(labels[EXECUTION_PROFILES.indexOf('default')]).toBe('Default')
      })
      And('"full-access" is called "Full Access"', () => {
        expect(labels[EXECUTION_PROFILES.indexOf('full-access')]).toBe('Full Access')
        expect(labels.every((label) => typeof label === 'string' && label.length > 0)).toBe(true)
      })
    })
  })
})
