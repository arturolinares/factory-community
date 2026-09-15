import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availability } from '../src/providers/capability.js'
import {
  commandAvailability,
  knownToolDirectories,
  resolveCommand,
  type Availability,
} from '../src/providers/discover.js'
import type { ProviderDescriptor } from '../src/providers/descriptor.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./provider-resolution.feature', import.meta.url)),
)

describeFeature(feature, ({ Background, Scenario, Rule, AfterEachScenario }) => {
  let root = ''
  let descriptor: ProviderDescriptor
  let env: Record<string, string | undefined>
  let extraDirectories: string[]
  let configFile: string | undefined
  let result: Availability
  /** The caller's own advice, for the probe that is not provider-shaped. */
  let hint: string | undefined

  AfterEachScenario(() => rmSync(root, { recursive: true, force: true }))

  /**
   * Real directories and real files, because the thing under test is whether a
   * file on disk can be executed — which a fake filesystem would answer by
   * assertion rather than by checking.
   */
  const dir = (path: string): string => {
    const real = join(root, path.replaceAll('/', '_'))
    mkdirSync(real, { recursive: true })
    return real
  }
  const install = (command: string, where: string, mode = 0o755): string => {
    const real = dir(where)
    const file = join(real, command)
    writeFileSync(file, '#!/bin/sh\n')
    chmodSync(file, mode)
    return file
  }

  // Built in Background: Background steps run before BeforeEachScenario.
  Background(({ Given }) => {
    Given('a provider "claude" whose command is "claude"', () => {
      root = mkdtempSync(join(tmpdir(), 'factory-which-'))
      env = { PATH: '' }
      extraDirectories = []
      configFile = undefined
      hint = undefined
      descriptor = {
        id: 'claude',
        displayName: 'Claude Code',
        summary: 'Anthropic.',
        command: 'claude',
        supports: [],
        models: {},
        permissionArgs: [],
        extraArgs: [],
        provisional: false,
      } as unknown as ProviderDescriptor
    })
  })

  const check = (): void => {
    result = availability(descriptor, env, {
      extraDirectories,
      ...(configFile === undefined ? {} : { configFile }),
    })
  }
  const pathContains = (...directories: string[]): void => {
    env.PATH = directories.map((entry) => dir(entry)).join(delimiter)
  }

  Scenario('found on PATH', ({ Given, And, When, Then }) => {
    Given('"claude" is installed in "/usr/local/bin"', () => {
      install('claude', '/usr/local/bin')
    })
    And('PATH contains "/usr/local/bin"', () => pathContains('/usr/local/bin'))
    When('availability is checked', check)
    Then('it is available', () => expect(result.available).toBe(true))
    And('the path found is "/usr/local/bin/claude"', () =>
      expect(result.path).toBe(join(dir('/usr/local/bin'), 'claude')),
    )
  })

  Scenario('found where things are usually installed, though PATH says nothing', ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('"claude" is installed in "/opt/homebrew/bin"', () => {
      install('claude', '/opt/homebrew/bin')
    })
    And('PATH is empty', () => {
      env.PATH = ''
    })
    // An app launched from Finder has almost no PATH; this is what saves it.
    And('"/opt/homebrew/bin" is one of the usual locations', () => {
      extraDirectories = [dir('/opt/homebrew/bin')]
    })
    When('availability is checked', check)
    Then('it is available', () => expect(result.available).toBe(true))
    And('the path found is "/opt/homebrew/bin/claude"', () =>
      expect(result.path).toBe(join(dir('/opt/homebrew/bin'), 'claude')),
    )
  })

  Scenario('PATH wins over the usual locations', ({ Given, And, When, Then }) => {
    Given('"claude" is installed in "/usr/local/bin"', () => {
      install('claude', '/usr/local/bin')
    })
    And('"claude" is installed in "/opt/homebrew/bin"', () => {
      install('claude', '/opt/homebrew/bin')
    })
    And('PATH contains "/usr/local/bin"', () => pathContains('/usr/local/bin'))
    And('"/opt/homebrew/bin" is one of the usual locations', () => {
      extraDirectories = [dir('/opt/homebrew/bin')]
    })
    When('availability is checked', check)
    Then('the path found is "/usr/local/bin/claude"', () =>
      expect(result.path).toBe(join(dir('/usr/local/bin'), 'claude')),
    )
  })

  Scenario('a configured command wins outright', ({ Given, And, When, Then }) => {
    Given('the provider\'s command is "/opt/agents/claude-nightly"', () => {
      install('claude-nightly', '/opt/agents')
      descriptor = {
        ...descriptor,
        command: join(dir('/opt/agents'), 'claude-nightly'),
      } as ProviderDescriptor
    })
    And('"claude-nightly" is installed in "/opt/agents"', () => {
      // Installed by the step above; named here so the scenario reads in order.
    })
    And('PATH is empty', () => {
      env.PATH = ''
    })
    When('availability is checked', check)
    Then('it is available', () => expect(result.available).toBe(true))
    And('the path found is "/opt/agents/claude-nightly"', () =>
      expect(result.path).toBe(join(dir('/opt/agents'), 'claude-nightly')),
    )
  })

  Scenario('a configured command that is not there says so plainly', ({
    Given,
    And,
    When,
    Then,
  }) => {
    Given('the provider\'s command is "/opt/agents/claude-nightly"', () => {
      descriptor = {
        ...descriptor,
        command: join(dir('/opt/agents'), 'claude-nightly'),
      } as ProviderDescriptor
    })
    And('nothing is installed there', () => {
      // Deliberately empty.
    })
    When('availability is checked', check)
    Then('it is not available', () => expect(result.available).toBe(false))
    And('the reason names the configured path', () =>
      expect(result.reason).toContain('claude-nightly'),
    )
  })

  Scenario('a file that is not executable does not count', ({ Given, And, When, Then }) => {
    Given('"claude" exists in "/usr/local/bin" but cannot be executed', () => {
      install('claude', '/usr/local/bin', 0o644)
    })
    And('PATH contains "/usr/local/bin"', () => pathContains('/usr/local/bin'))
    When('availability is checked', check)
    Then('it is not available', () => expect(result.available).toBe(false))
  })

  Scenario('not found anywhere says where it looked', ({ Given, And, When, Then }) => {
    Given('PATH contains "/usr/bin"', () => pathContains('/usr/bin'))
    And('"/opt/homebrew/bin" is one of the usual locations', () => {
      extraDirectories = [dir('/opt/homebrew/bin')]
    })
    When('availability is checked', check)
    Then('it is not available', () => expect(result.available).toBe(false))
    And('the reason names "/usr/bin"', () => expect(result.reason).toContain('_usr_bin'))
    And('the reason names "/opt/homebrew/bin"', () =>
      expect(result.reason).toContain('_opt_homebrew_bin'),
    )
    // The one sentence that fixes it on any machine.
    And('the reason says how to configure the path', () =>
      expect(result.reason).toContain('providers.claude.command'),
    )
    And('every directory tried is reported', () => expect(result.searched).toHaveLength(2))
  })

  Scenario('a long search is summarised rather than listed in full', ({ Given, When, Then, And }) => {
    Given('PATH contains 12 directories', () =>
      pathContains(...Array.from({ length: 12 }, (_, index) => `/bin${index}`)),
    )
    When('availability is checked', check)
    Then('the reason mentions the first few and counts the rest', () =>
      expect(result.reason).toContain('9 other directories'),
    )
    And('every directory tried is still reported', () =>
      expect(result.searched).toHaveLength(12),
    )
  })

  Scenario('a directory listed twice is searched once', ({ Given, And, When, Then }) => {
    Given('PATH contains "/usr/local/bin" twice', () =>
      pathContains('/usr/local/bin', '/usr/local/bin'),
    )
    And('"/usr/local/bin" is one of the usual locations', () => {
      extraDirectories = [dir('/usr/local/bin')]
    })
    When('availability is checked', check)
    Then('"/usr/local/bin" was searched once', () => expect(result.searched).toHaveLength(1))
  })

  Rule('discovery describes a machine, so it needs one described', ({ RuleScenario }) => {
    let resolved: string
    let directories: string[]
    let command = 'claude'

    RuleScenario('an environment that says nothing is not searched', ({ Given, When, Then }) => {
      Given('an environment with no HOME and no PATH', () => {
        env = {}
      })
      When('the usual locations are listed', () => {
        directories = knownToolDirectories(env)
      })
      // Otherwise a test passes or fails according to what is installed on the
      // laptop running it.
      Then('there are none', () => expect(directories).toEqual([]))
    })

    RuleScenario('an agent on PATH is run by name', ({ Given, And, When, Then }) => {
      Given('"claude" is installed in "/usr/local/bin"', () => {
        install('claude', '/usr/local/bin')
      })
      And('PATH contains "/usr/local/bin"', () => pathContains('/usr/local/bin'))
      When('the command is resolved', () => {
        resolved = resolveCommand('claude', env)
      })
      // Friendlier in a log, and it keeps working if the install moves.
      Then('the command stays "claude"', () => expect(resolved).toBe('claude'))
    })

    RuleScenario('an agent found off PATH is run by its full path', ({
      Given,
      And,
      When,
      Then,
    }) => {
      let expected = ''
      // A real nested home, not the flattened sandbox layout: the thing under
      // test is that `$HOME/.local/bin` is one of the places looked in.
      Given('a home directory with "claude" in ".local/bin"', () => {
        const home = join(root, 'home')
        mkdirSync(join(home, '.local', 'bin'), { recursive: true })
        expected = join(home, '.local', 'bin', 'claude')
        writeFileSync(expected, '#!/bin/sh\n')
        chmodSync(expected, 0o755)
        env = { HOME: home, PATH: '' }
      })
      And('PATH is empty', () => {
        env.PATH = ''
      })
      When('the command is resolved', () => {
        resolved = resolveCommand('claude', env)
      })
      // A child process inherits the same PATH, so a bare name would fail with
      // "command not found" on something just reported as available.
      Then('the command is the full path to it', () => expect(resolved).toBe(expected))
    })

    RuleScenario('an agent nowhere to be found is left alone', ({ Given, When, Then }) => {
      Given('an environment with a home directory and nothing installed', () => {
        env = { HOME: dir('/empty-home'), PATH: '' }
      })
      When('the command is resolved', () => {
        resolved = resolveCommand('claude', env)
      })
      Then('the command stays "claude"', () => expect(resolved).toBe('claude'))
    })

    RuleScenario('a configured absolute command is never second-guessed', ({
      Given,
      When,
      Then,
    }) => {
      Given('the provider\'s command is "/opt/agents/claude-nightly"', () => {
        command = '/opt/agents/claude-nightly'
      })
      When('the command is resolved', () => {
        resolved = resolveCommand(command, { HOME: dir('/home'), PATH: '' })
      })
      Then('the command stays "/opt/agents/claude-nightly"', () =>
        expect(resolved).toBe('/opt/agents/claude-nightly'),
      )
    })
  })

  Rule('the fix names a file that exists, not a path we assume', ({ RuleScenario }) => {
    RuleScenario('the caller\'s config file is the one named', ({ Given, And, When, Then }) => {
      Given('PATH contains "/usr/bin"', () => pathContains('/usr/bin'))
      And(
        'the caller knows the config file is "/home/someone/.xaedalon/.factory/config.yaml"',
        () => {
          configFile = '/home/someone/.xaedalon/.factory/config.yaml'
        },
      )
      When('availability is checked', check)
      Then('it is not available', () => expect(result.available).toBe(false))
      And('the reason names "/home/someone/.xaedalon/.factory/config.yaml"', () =>
        expect(result.reason).toContain('/home/someone/.xaedalon/.factory/config.yaml'),
      )
    })

    RuleScenario('with no config file the reason still says what to set', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('PATH contains "/usr/bin"', () => pathContains('/usr/bin'))
      When('availability is checked', check)
      Then('it is not available', () => expect(result.available).toBe(false))
      And('the reason says how to configure the path', () =>
        expect(result.reason).toContain('providers.claude.command'),
      )
      // The point of the rule: no invented path, of either generation.
      And('the reason names no scope directory', () => {
        expect(result.reason).not.toContain('.factory')
        expect(result.reason).not.toContain('.xaedalon')
      })
    })
  })

  Rule('the search is a question about a command, not about a provider', ({ RuleScenario }) => {
    const probe = (command: string, options: { usual?: boolean } = {}) => () => {
      result = commandAvailability(command, env, {
        ...(options.usual === true ? { extraDirectories } : {}),
        ...(hint === undefined ? {} : { hint }),
      })
    }
    const pathContains = (where: string) => {
      env.PATH = [env.PATH, dir(where)].filter((part) => part !== '').join(delimiter)
    }

    RuleScenario('a bare command found on PATH', ({ Given, And, When, Then }) => {
      Given('"diffity" is installed in "/usr/local/bin"', () => {
        install('diffity', '/usr/local/bin')
      })
      And('PATH contains "/usr/local/bin"', () => pathContains('/usr/local/bin'))
      When('the command "diffity" is probed', probe('diffity'))
      Then('it is available', () => expect(result.available).toBe(true))
      And('the path found is "/usr/local/bin/diffity"', () =>
        expect(result.path).toBe(join(dir('/usr/local/bin'), 'diffity')),
      )
    })

    RuleScenario("a command that is nowhere carries the caller's own advice", ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('PATH contains "/usr/bin"', () => pathContains('/usr/bin'))
      And('the caller\'s advice is "Install it with npm install -g diffity."', () => {
        hint = 'Install it with npm install -g diffity.'
      })
      When('the command "diffity" is probed', probe('diffity'))
      Then('it is not available', () => expect(result.available).toBe(false))
      And('the reason names "/usr/bin"', () =>
        expect(result.reason).toContain(dir('/usr/bin')),
      )
      And("the reason ends with the caller's advice", () =>
        expect(result.reason?.endsWith('Install it with npm install -g diffity.')).toBe(true),
      )
    })

    RuleScenario('with no advice the reason is just where it looked', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('PATH contains "/usr/bin"', () => pathContains('/usr/bin'))
      When('the command "diffity" is probed', probe('diffity'))
      Then('it is not available', () => expect(result.available).toBe(false))
      // The provider's config-key advice is the provider's, not the probe's.
      And('the reason says nothing about configuring anything', () => {
        expect(result.reason).not.toContain('providers.')
        expect(result.reason).not.toContain('config.yaml')
      })
    })

    RuleScenario("the usual locations are the caller's to supply", ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('"diffity" is installed in "/opt/homebrew/bin"', () => {
        install('diffity', '/opt/homebrew/bin')
      })
      And('PATH is empty', () => {
        env.PATH = ''
      })
      And('"/opt/homebrew/bin" is one of the usual locations', () => {
        extraDirectories = [dir('/opt/homebrew/bin')]
      })
      When('the command "diffity" is probed with the usual locations', () =>
        probe('diffity', { usual: true })(),
      )
      Then('it is available', () => expect(result.available).toBe(true))
    })
  })
})
