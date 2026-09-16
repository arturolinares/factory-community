import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  outsideWorkspaceMessage,
  systemCanonical,
  withinWorkspace,
} from '../src/security/boundary.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./workspace-boundary.feature', import.meta.url)),
)

describeFeature(feature, ({ Scenario, Rule, BeforeEachScenario, AfterEachScenario }) => {
  let workspace: string
  let links: Map<string, string>
  let inside: boolean | undefined
  let reason: string
  let temporary: string | undefined

  BeforeEachScenario(() => {
    workspace = ''
    links = new Map()
    inside = undefined
    reason = ''
    temporary = undefined
  })

  AfterEachScenario(() => {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true })
  })

  /**
   * The table double. Longest match wins, so a link on the workspace itself
   * also moves everything under it — which is what a real symlinked parent does.
   */
  const table = (path: string): string => {
    const direct = links.get(path)
    if (direct !== undefined) return direct
    for (const [from, to] of [...links].sort((a, b) => b[0].length - a[0].length)) {
      if (path.startsWith(from + '/')) return to + path.slice(from.length)
    }
    return path
  }

  const workspaceIs = (path: string) => (): void => {
    workspace = path
  }
  const reallyMeans = (from: string, to: string) => (): void => {
    links.set(from, to)
  }
  const check = (path: string) => (): void => {
    inside = withinWorkspace(path, workspace, table)
  }
  const isInside = (yes: boolean) => (): void => {
    expect(inside).toBe(yes)
  }

  /** A real tree: <root>/work is the workspace, with a link out and a real child. */
  const realTree = (): void => {
    temporary = mkdtempSync(join(tmpdir(), 'factory-boundary-'))
    mkdirSync(join(temporary, 'work', 'src'), { recursive: true })
    mkdirSync(join(temporary, 'outside'), { recursive: true })
    symlinkSync(join(temporary, 'outside'), join(temporary, 'work', 'escape'), 'dir')
    workspace = join(temporary, 'work')
  }
  const checkReal = (relative: string) => (): void => {
    inside = withinWorkspace(join(workspace, relative), workspace, systemCanonical)
  }

  Scenario('A directory under the workspace is inside it', ({ Given, When, Then }) => {
    Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
    When('I check "/repos/todolist/src/api"', check('/repos/todolist/src/api'))
    Then('it is inside the workspace', isInside(true))
  })

  Scenario('The workspace itself is inside it', ({ Given, When, Then }) => {
    Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
    When('I check "/repos/todolist"', check('/repos/todolist'))
    Then('it is inside the workspace', isInside(true))
  })

  Scenario('A trailing separator does not change the answer', ({ Given, When, Then }) => {
    Given('the workspace is "/repos/todolist/"', workspaceIs('/repos/todolist/'))
    When('I check "/repos/todolist"', check('/repos/todolist'))
    Then('it is inside the workspace', isInside(true))
  })

  Scenario('Somewhere else entirely is outside', ({ Given, When, Then }) => {
    Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
    When('I check "/tmp"', check('/tmp'))
    Then('it is outside the workspace', isInside(false))
  })

  Scenario('The parent of the workspace is outside', ({ Given, When, Then }) => {
    Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
    When('I check "/repos"', check('/repos'))
    Then('it is outside the workspace', isInside(false))
  })

  Rule('a sibling whose name starts the same way is not inside', ({ RuleScenario }) => {
    RuleScenario('A sibling sharing a prefix is outside', ({ Given, When, Then }) => {
      Given('the workspace is "/repos/todo"', workspaceIs('/repos/todo'))
      When('I check "/repos/todolist/src"', check('/repos/todolist/src'))
      Then('it is outside the workspace', isInside(false))
    })

    RuleScenario('A sibling sharing a prefix exactly is outside', ({ Given, When, Then }) => {
      Given('the workspace is "/repos/todo"', workspaceIs('/repos/todo'))
      When('I check "/repos/todolist"', check('/repos/todolist'))
      Then('it is outside the workspace', isInside(false))
    })
  })

  Rule('the check is on the resolved path, not the written one', ({ RuleScenario }) => {
    RuleScenario('Climbing out with ".." is outside', ({ Given, And, When, Then }) => {
      Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
      And(
        '"/repos/todolist/../secrets" really means "/repos/secrets"',
        reallyMeans('/repos/todolist/../secrets', '/repos/secrets'),
      )
      When('I check "/repos/todolist/../secrets"', check('/repos/todolist/../secrets'))
      Then('it is outside the workspace', isInside(false))
    })

    RuleScenario('Climbing out and back in again is inside', ({ Given, And, When, Then }) => {
      Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
      And(
        '"/repos/todolist/../todolist/src" really means "/repos/todolist/src"',
        reallyMeans('/repos/todolist/../todolist/src', '/repos/todolist/src'),
      )
      When('I check "/repos/todolist/../todolist/src"', check('/repos/todolist/../todolist/src'))
      Then('it is inside the workspace', isInside(true))
    })

    RuleScenario('A link out of the workspace is outside', ({ Given, And, When, Then }) => {
      Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
      And(
        '"/repos/todolist/etc" really means "/etc"',
        reallyMeans('/repos/todolist/etc', '/etc'),
      )
      When('I check "/repos/todolist/etc"', check('/repos/todolist/etc'))
      Then('it is outside the workspace', isInside(false))
    })

    RuleScenario('A workspace that is itself a link is compared as what it is', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
      And(
        '"/repos/todolist" really means "/mnt/work/todolist"',
        reallyMeans('/repos/todolist', '/mnt/work/todolist'),
      )
      And(
        '"/repos/todolist/src" really means "/mnt/work/todolist/src"',
        reallyMeans('/repos/todolist/src', '/mnt/work/todolist/src'),
      )
      When('I check "/repos/todolist/src"', check('/repos/todolist/src'))
      Then('it is inside the workspace', isInside(true))
    })
  })

  Rule('the real implementation resolves links, and says what it cannot do', ({ RuleScenario }) => {
    RuleScenario('A real link out of a real workspace is refused', ({ Given, When, Then }) => {
      Given('a real directory with a link in it pointing outside', realTree)
      When('I check the link with the real implementation', checkReal('escape'))
      Then('it is outside the workspace', isInside(false))
    })

    RuleScenario('A real directory inside a real workspace is allowed', ({ Given, When, Then }) => {
      Given('a real directory with a link in it pointing outside', realTree)
      When('I check a real subdirectory with the real implementation', checkReal('src'))
      Then('it is inside the workspace', isInside(true))
    })

    RuleScenario('A path that does not exist yet is resolved lexically', ({
      Given,
      When,
      Then,
    }) => {
      Given('a real directory with a link in it pointing outside', realTree)
      When(
        'I check a subdirectory that has not been created yet',
        checkReal('worktrees/add-due-dates'),
      )
      Then('it is inside the workspace', isInside(true))
    })
  })

  Rule('the refusal explains itself in one wording', ({ RuleScenario }) => {
    RuleScenario('The refusal names the path, the workspace and the way out', ({
      Given,
      When,
      Then,
      And,
    }) => {
      Given('the workspace is "/repos/todolist"', workspaceIs('/repos/todolist'))
      When('I ask why "/tmp" was refused', () => {
        reason = outsideWorkspaceMessage("The phase's working directory", '/tmp', '/repos/todolist')
      })
      Then('the reason names "/tmp"', () => expect(reason).toContain('/tmp'))
      And('the reason names "/repos/todolist"', () => expect(reason).toContain('/repos/todolist'))
      And('the reason says which profile allows it', () =>
        expect(reason).toContain('Full Access'),
      )
    })
  })
})
