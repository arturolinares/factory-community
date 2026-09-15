import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { CapabilityHost, type Problem } from '@factory/core'
import { Sandbox } from './support.js'
import { resolveScopes, type ScopeChain } from '../src/scopes.js'
import { builtinDoctorPlugin, doctorContext, runDoctor } from '../src/doctor.js'

const feature = await loadFeature(fileURLToPath(new URL('./legacy-scopes.feature', import.meta.url)))

describeFeature(feature, ({ Background, Scenario, AfterEachScenario }) => {
  let box: Sandbox
  let host: CapabilityHost
  let chain: ScopeChain
  let problems: readonly Problem[] = []

  AfterEachScenario(() => box.cleanup())

  // Built in Background: the runner executes Background steps before anything
  // in BeforeEachScenario exists.
  Background(({ Given }) => {
    Given('the built-in doctor rules are registered', async () => {
      box = new Sandbox()
      host = new CapabilityHost()
      await host.load(builtinDoctorPlugin)
      problems = []
    })
  })

  /**
   * `FACTORY_HOME` is taken exactly as given, which is what lets a scenario put
   * the user scope at either spelling without touching a real home directory.
   */
  const resolveFrom = (userRoot: string, cwd: string): void => {
    chain = resolveScopes({ cwd, env: { FACTORY_HOME: userRoot } })
  }

  const about = () => problems.filter((problem) => problem.rule === 'doctor.legacyScope')

  const runIt = async (): Promise<void> => {
    const report = await runDoctor(doctorContext({ chain, host, env: {} }))
    problems = report.problems
  }

  Scenario('A user scope at the old path is reported', ({ Given, When, Then, And }) => {
    Given('a user scope at the old path', () => {
      resolveFrom(box.legacyScope('home', 'user'), box.dir('somewhere'))
    })
    When('doctor runs', runIt)
    Then('doctor reports a scope at the old path', () => expect(about()).toHaveLength(1))
    // The command, not just the complaint: "this moved" without saying where to
    // is a warning someone has to go and research.
    And('the report names where to move it', () =>
      expect(about()[0]?.message).toContain('.xaedalon'),
    )
  })

  Scenario('A project scope at the old path is reported', ({ Given, When, Then }) => {
    Given('a project scope at the old path', () => {
      box.legacyScope('work')
      resolveFrom(box.scope('home', 'user'), box.dir('work', 'src'))
    })
    When('doctor runs', runIt)
    Then('doctor reports a scope at the old path', () => expect(about()).toHaveLength(1))
  })

  Scenario('Scopes at the new path are not reported', ({ Given, When, Then }) => {
    Given('a user scope at the new path', () => {
      resolveFrom(box.scope('home', 'user'), box.dir('somewhere'))
    })
    When('doctor runs', runIt)
    Then('doctor says nothing about scope paths', () => expect(about()).toEqual([]))
  })

  Scenario('A scope that is not there is not reported', ({ Given, When, Then }) => {
    // A path nobody has created is not a migration anyone has to do.
    Given('a user scope at the old path that does not exist', () => {
      resolveFrom(box.path('home', '.factory'), box.dir('somewhere'))
    })
    When('doctor runs', runIt)
    Then('doctor says nothing about scope paths', () => expect(about()).toEqual([]))
  })
})
