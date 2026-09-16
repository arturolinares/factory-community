import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ProcessRegistry,
  processGroup,
  STOP_GRACE_MS,
  type StopReport,
  type StopSignal,
  type StoppableProcess,
} from '../src/security/processes.js'

const feature = await loadFeature(fileURLToPath(new URL('./processes.feature', import.meta.url)))

/** A process that records what it was sent and decides whether it goes. */
interface Fake extends StoppableProcess {
  readonly sent: StopSignal[]
}

const fake = (behaviour: 'exits' | 'ignores' | 'gone'): Fake => {
  const sent: StopSignal[] = []
  let alive = behaviour !== 'gone'
  return {
    pid: 1234,
    sent,
    kill: (signal) => {
      if (!alive) return false
      sent.push(signal)
      // "Exits on SIGTERM" is the same thing as "a second signal finds nothing".
      if (behaviour === 'exits' && signal === 'SIGTERM') alive = false
      return true
    },
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Children of a pid, asked of the operating system rather than remembered. */
const childrenOf = (pid: number): number[] => {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    // pgrep exits non-zero when it matches nothing.
    return []
  }
}

const until = async (predicate: () => boolean, ms = 4_000): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

describeFeature(feature, ({ Scenario, Rule, BeforeEachScenario, AfterEachScenario }) => {
  let registry: ProcessRegistry
  let waited: number[]
  let fakes: Map<string, Fake[]>
  let forget: (() => void) | undefined
  let report: StopReport | undefined
  let registered: boolean | undefined
  let shell: ChildProcess | undefined
  let grandchild: number | undefined

  BeforeEachScenario(() => {
    waited = []
    fakes = new Map()
    forget = undefined
    report = undefined
    registered = undefined
    shell = undefined
    grandchild = undefined
    registry = new ProcessRegistry({
      wait: async (ms) => {
        waited.push(ms)
      },
    })
  })

  AfterEachScenario(() => {
    // Nothing is left running, whatever the scenario asserted. The one scenario
    // that deliberately leaves a grandchild alive is cleaned up here.
    if (grandchild !== undefined && alive(grandchild)) {
      try {
        process.kill(grandchild, 'SIGKILL')
      } catch {
        // Already gone between the check and the signal. Fine.
      }
    }
    if (shell?.pid !== undefined) {
      try {
        process.kill(-shell.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  })

  const register =
    (runId: string, behaviour: 'exits' | 'ignores' | 'gone' = 'ignores') =>
    (): void => {
      const target = fake(behaviour)
      fakes.set(runId, [...(fakes.get(runId) ?? []), target])
      forget = registry.add(runId, target)
    }
  const stop = (runId: string) => async (): Promise<void> => {
    report = await registry.stop(runId)
  }
  const sentTo = (runId: string): StopSignal[] => (fakes.get(runId) ?? []).flatMap((f) => f.sent)
  const reportSays = (signalled: number, killed: number) => (): void => {
    expect(report).toEqual({ signalled, killed })
  }

  Scenario('A registered process is held against its run', ({ Given, Then, And }) => {
    Given('a process registered for run "r1"', register('r1'))
    Then('the registry holds 1 process', () => expect(registry.count()).toBe(1))
    And('it holds 1 process for "r1"', () => expect(registry.count('r1')).toBe(1))
    And('"r1" is listed as running something', () => expect(registry.runs()).toEqual(['r1']))
  })

  Scenario('Forgetting a process releases the run', ({ Given, When, Then, And }) => {
    Given('a process registered for run "r1"', register('r1'))
    When('it is forgotten', () => forget?.())
    Then('the registry holds nothing', () => expect(registry.count()).toBe(0))
    And('nothing is listed as running', () => expect(registry.runs()).toEqual([]))
  })

  Scenario('Two runs are held apart', ({ Given, And, When, Then }) => {
    Given('a process registered for run "r1"', register('r1'))
    And('a process registered for run "r2"', register('r2'))
    When('"r1" is stopped', stop('r1'))
    Then('only "r1" got a signal', () => {
      expect(sentTo('r1').length).toBeGreaterThan(0)
      expect(sentTo('r2')).toEqual([])
    })
    And('the registry still holds 2 processes', () => expect(registry.count()).toBe(2))
  })

  Rule('polite first, then not', ({ RuleScenario }) => {
    RuleScenario('A process that exits politely is never killed', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('a process registered for run "r1" that exits on SIGTERM', register('r1', 'exits'))
      When('"r1" is stopped', stop('r1'))
      Then('it was sent SIGTERM', () => expect(sentTo('r1')).toContain('SIGTERM'))
      And('it was not sent SIGKILL', () => expect(sentTo('r1')).not.toContain('SIGKILL'))
      And('the report says 1 signalled and 0 killed', reportSays(1, 0))
    })

    RuleScenario('A process that ignores SIGTERM is killed', ({ Given, When, Then, And }) => {
      Given('a process registered for run "r1" that ignores signals', register('r1', 'ignores'))
      When('"r1" is stopped', stop('r1'))
      Then('it was sent SIGTERM', () => expect(sentTo('r1')).toContain('SIGTERM'))
      And('the grace period was waited out first', () => expect(waited).toEqual([STOP_GRACE_MS]))
      And('it was sent SIGKILL', () => expect(sentTo('r1')).toContain('SIGKILL'))
      And('the report says 1 signalled and 1 killed', reportSays(1, 1))
    })

    RuleScenario('A process that had already gone is not reported as stopped', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('a process registered for run "r1" that has already gone', register('r1', 'gone'))
      When('"r1" is stopped', stop('r1'))
      Then('the report says 0 signalled and 0 killed', reportSays(0, 0))
      And('no grace period was waited out', () => expect(waited).toEqual([]))
    })

    RuleScenario('Stopping a run with nothing registered is not an error', ({ When, Then }) => {
      When('"r1" is stopped', stop('r1'))
      Then('the report says 0 signalled and 0 killed', reportSays(0, 0))
    })
  })

  Rule('stop all means all', ({ RuleScenario }) => {
    RuleScenario("Every run's processes are stopped", ({ Given, And, When, Then }) => {
      Given('a process registered for run "r1"', register('r1'))
      And('a process registered for run "r2"', register('r2'))
      And('a second process registered for run "r2"', register('r2'))
      When('everything is stopped', async () => {
        report = await registry.stopAll()
      })
      Then('the report says 3 signalled and 3 killed', reportSays(3, 3))
    })

    RuleScenario('Stopping everything when nothing runs is not an error', ({ When, Then }) => {
      When('everything is stopped', async () => {
        report = await registry.stopAll()
      })
      Then('the report says 0 signalled and 0 killed', reportSays(0, 0))
    })
  })

  Rule('a spawn that never started registers nothing', ({ RuleScenario }) => {
    RuleScenario('A child with no pid cannot be held', ({ Given, Then }) => {
      Given('a child process that failed to start', () => {
        registered = processGroup({ pid: undefined, kill: () => false }) !== undefined
      })
      Then('it cannot be registered', () => expect(registered).toBe(false))
    })
  })

  Rule('the group, not the process — proved on a real one', ({ RuleScenario }) => {
    const realShell = async (): Promise<void> => {
      // `wait` keeps bash alive while the grandchild sleeps, which is the shape
      // of a Factory step: `bash -c '<the project's command>'`.
      shell = spawn('bash', ['-c', 'sleep 30 & wait'], { detached: true, stdio: 'ignore' })
      const found = await until(() => childrenOf(shell?.pid ?? 0).length > 0)
      expect(found, 'the shell never started a grandchild').toBe(true)
      grandchild = childrenOf(shell?.pid ?? 0)[0]
      expect(grandchild).toBeGreaterThan(0)
    }

    RuleScenario('Killing the group takes the grandchild with it', ({ Given, When, Then }) => {
      Given('a real detached shell whose work is a grandchild', realShell)
      When('its group is stopped', async () => {
        const target = processGroup(shell as ChildProcess)
        expect(target).toBeDefined()
        // The real grace period is not wanted here; the registry's injected
        // wait makes SIGKILL follow immediately.
        registry.add('real', target as StoppableProcess)
        report = await registry.stop('real')
      })
      Then('the grandchild is gone', async () => {
        const gone = await until(() => !alive(grandchild as number))
        expect(gone, `pid ${grandchild} survived the group kill`).toBe(true)
      })
    })

    RuleScenario('Killing only the process would leave the grandchild', ({
      Given,
      When,
      Then,
    }) => {
      Given('a real detached shell whose work is a grandchild', realShell)
      When('only the shell itself is signalled', () => {
        ;(shell as ChildProcess).kill('SIGKILL')
      })
      Then('the grandchild is still there', async () => {
        // The shell goes; its child is reparented and carries on. This is the
        // behaviour the old code shipped.
        await until(() => !alive((shell as ChildProcess).pid as number), 2_000)
        expect(alive(grandchild as number)).toBe(true)
      })
    })
  })
})
