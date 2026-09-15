import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Sandbox } from './support.js'
import { resolveScopes, type ScopeChain } from '../src/scopes.js'
import { writeTarget } from '../src/store.js'

const feature = await loadFeature(
  fileURLToPath(new URL('./scope-discovery.feature', import.meta.url)),
)

describeFeature(feature, ({ Rule, Scenario, BeforeEachScenario, AfterEachScenario }) => {
  let box: Sandbox
  let cwd = ''
  let env: Record<string, string | undefined> = {}
  let chain: ScopeChain
  let userScopeRootPath = ''

  BeforeEachScenario(() => {
    box = new Sandbox()
    cwd = ''
    env = {}
    userScopeRootPath = ''
  })
  AfterEachScenario(() => box.cleanup())

  const kinds = () => chain.scopes.map((scope) => scope.kind).join(', ')
  const resolve = () => {
    chain = resolveScopes({ cwd, env })
  }

  // `FACTORY_HOME` is how a test pins the user scope without touching the real
  // one. Discovery must never read the developer's actual home directory.
  const givenUserScope = () => {
    userScopeRootPath = box.scope('home', 'user')
    env.FACTORY_HOME = userScopeRootPath
  }

  Scenario('With no project nearby, the user scope is the only writable one', ({ Given, And, When, Then }) => {
    Given('a home directory containing a user scope', givenUserScope)
    And('a working directory outside any project', () => {
      cwd = box.dir('somewhere', 'else')
    })
    When('the scopes are resolved', resolve)
    Then('the chain is "user, builtin"', () => expect(kinds()).toBe('user, builtin'))
    And('the default write scope is "user"', () => expect(chain.defaultWriteScope).toBe('user'))
  })

  Scenario('A project scope is found by walking up', ({ Given, And, When, Then }) => {
    Given('a home directory containing a user scope', givenUserScope)
    And('a project at "work/app" containing a project scope', () => {
      box.scope(join('work', 'app'))
    })
    And('the working directory is "work/app/src/deep"', () => {
      cwd = box.dir('work', 'app', 'src', 'deep')
    })
    When('the scopes are resolved', resolve)
    Then('the chain is "project, user, builtin"', () =>
      expect(kinds()).toBe('project, user, builtin'),
    )
    And('the default write scope is "project"', () =>
      expect(chain.defaultWriteScope).toBe('project'),
    )
  })

  Scenario('The home directory is never treated as a project', ({ Given, And, When, Then }) => {
    Given('a home directory containing a user scope', givenUserScope)
    And('the working directory is inside the home directory', () => {
      cwd = box.dir('home', 'notes')
    })
    When('the scopes are resolved', resolve)
    Then('the chain is "user, builtin"', () => expect(kinds()).toBe('user, builtin'))
    And('the project scope is not the user scope', () =>
      expect(chain.scopes.filter((s) => s.kind === 'project')).toHaveLength(0),
    )
  })

  Scenario('A scope that declares itself a user scope is skipped', ({ Given, And, When, Then }) => {
    Given('a shared directory whose .factory declares scope "user"', () => {
      box.scope('shared', 'user')
      env.FACTORY_HOME = box.scope('home', 'user')
    })
    And('the working directory is below that shared directory', () => {
      cwd = box.dir('shared', 'project', 'src')
    })
    When('the scopes are resolved', resolve)
    Then('no project scope is found', () =>
      expect(chain.scopes.some((s) => s.kind === 'project')).toBe(false),
    )
  })

  Scenario('Discovery stops at the repository boundary', ({ Given, And, When, Then }) => {
    Given('a project at "work/outer" containing a project scope', () => {
      env.FACTORY_HOME = box.scope('home', 'user')
      box.scope(join('work', 'outer'))
    })
    And('a git repository at "work/outer/inner" with no scope of its own', () => {
      box.dir('work', 'outer', 'inner', '.git')
    })
    And('the working directory is "work/outer/inner/src"', () => {
      cwd = box.dir('work', 'outer', 'inner', 'src')
    })
    When('the scopes are resolved', resolve)
    Then('no project scope is found', () =>
      expect(chain.scopes.some((s) => s.kind === 'project')).toBe(false),
    )
  })

  Scenario('FACTORY_HOME relocates the user scope', ({ Given, And, When, Then }) => {
    Given('FACTORY_HOME points at a directory "elsewhere"', () => {
      userScopeRootPath = box.dir('elsewhere')
      env.FACTORY_HOME = userScopeRootPath
    })
    And('a working directory outside any project', () => {
      cwd = box.dir('somewhere')
    })
    When('the scopes are resolved', resolve)
    Then('the user scope root is "elsewhere"', () => {
      expect(chain.scopes.find((s) => s.kind === 'user')?.root).toBe(userScopeRootPath)
    })
  })

  Scenario('FACTORY_SCOPES replaces the whole chain', ({ Given, When, Then, And }) => {
    Given('FACTORY_SCOPES lists two scope directories', () => {
      const first = box.scope('one')
      const second = box.scope('two')
      env.FACTORY_SCOPES = `${first}:${second}`
      cwd = box.dir('anywhere')
    })
    When('the scopes are resolved', resolve)
    Then('the chain has 2 scopes', () => expect(chain.scopes).toHaveLength(2))
    And('no builtin scope is present', () =>
      expect(chain.scopes.some((s) => s.kind === 'builtin')).toBe(false),
    )
  })

  Scenario('The built-in scope is read-only', ({ Given, And, When, Then }) => {
    Given('a home directory containing a user scope', givenUserScope)
    And('a working directory outside any project', () => {
      cwd = box.dir('somewhere')
    })
    When('the scopes are resolved', resolve)
    Then('the builtin scope is not writable', () =>
      expect(chain.scopes.find((s) => s.kind === 'builtin')?.writable).toBe(false),
    )
    And('writing to the builtin scope is refused', () => {
      expect(() => writeTarget(chain, 'builtin')).toThrow(/read-only/)
    })
  })

  Scenario('The nearest repository is reported even when it has no scope', ({ Given, And, When, Then }) => {
    Given('a git repository at "work/app" with no scope of its own', () => {
      env.FACTORY_HOME = box.scope('home', 'user')
      box.dir('work', 'app', '.git')
    })
    And('the working directory is "work/app/src"', () => {
      cwd = box.dir('work', 'app', 'src')
    })
    When('the scopes are resolved', resolve)
    Then('no project scope is found', () =>
      expect(chain.scopes.some((s) => s.kind === 'project')).toBe(false),
    )
    And('the reported git root ends with "work/app"', () =>
      expect(chain.gitRoot?.endsWith(join('work', 'app'))).toBe(true),
    )
  })

  Scenario('a packaged build can say where the built-ins are', ({ Given, And, When, Then }) => {
    let shipped = ''
    Given('a directory of definitions that ships inside an application', () => {
      givenUserScope()
      cwd = box.dir('work')
      shipped = box.dir('Application.app', 'Contents', 'Resources', 'builtin')
    })
    // `builtinScopeRoot()` finds them relative to its own module, which is right
    // everywhere except where a bundler has flattened the package into one file.
    And('FACTORY_BUILTIN_ROOT points at it', () => {
      env.FACTORY_BUILTIN_ROOT = shipped
    })
    When('scopes are resolved', resolve)
    Then('the builtin scope is that directory', () =>
      expect(chain.scopes.find((scope) => scope.kind === 'builtin')?.root).toBe(shipped),
    )
    And('it is still read-only', () =>
      expect(chain.scopes.find((scope) => scope.kind === 'builtin')?.writable).toBe(false),
    )
  })

  Rule('a scope at the old path still works', ({ RuleScenario }) => {
    const projectScope = () => chain.scopes.find((scope) => scope.kind === 'project')
    const inWork = () => {
      cwd = box.dir('work', 'src')
    }

    RuleScenario('A project scope at the old path is still found', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a home directory containing a user scope', givenUserScope)
      And('a project at "work" whose scope is at the old path', () => {
        box.legacyScope('work')
      })
      And('the working directory is "work/src"', inWork)
      When('the scopes are resolved', resolve)
      Then('the chain is "project, user, builtin"', () =>
        expect(kinds()).toBe('project, user, builtin'),
      )
      And('the project scope is marked as legacy', () =>
        expect(projectScope()?.legacy).toBe(true),
      )
    })

    RuleScenario('The new path wins when a repository has both', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a home directory containing a user scope', givenUserScope)
      And('a project at "work" whose scope is at the old path', () => {
        box.legacyScope('work')
      })
      And('that project also has a scope at the new path', () => {
        box.scope('work')
      })
      And('the working directory is "work/src"', inWork)
      When('the scopes are resolved', resolve)
      // A repository part-way through the move has both, and the one under
      // `.xaedalon/` is the one meant to win.
      Then('the project scope is at the new path', () =>
        expect(projectScope()?.root).toBe(box.dir('work', '.xaedalon', '.factory')),
      )
      And('the project scope is not marked as legacy', () =>
        expect(projectScope()?.legacy).toBe(false),
      )
    })

    RuleScenario('A scope at the new path is not marked as legacy', ({
      Given,
      And,
      When,
      Then,
    }) => {
      Given('a home directory containing a user scope', givenUserScope)
      And('a project at "work" containing a project scope', () => {
        box.scope('work')
      })
      And('the working directory is "work/src"', inWork)
      When('the scopes are resolved', resolve)
      Then('the project scope is not marked as legacy', () =>
        expect(projectScope()?.legacy).toBe(false),
      )
    })
  })
})
