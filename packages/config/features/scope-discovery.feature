Feature: Finding the .factory directory
  Definitions live in a `.factory` directory. By default that is `~/.factory`,
  and a project can keep its own so the team's workflows are version-controlled
  alongside the code they belong to.

  Discovery walks up from the working directory, the way git and npm do, so a
  committed `.factory` means "clone the repo and it works" with no registration
  step. The prototype instead kept a list of absolute project paths in a global
  config file, which is why adding a workflow there required restarting the
  service.

  Scenario: With no project nearby, the user scope is the only writable one
    Given a home directory containing a user scope
    And a working directory outside any project
    When the scopes are resolved
    Then the chain is "user, builtin"
    And the default write scope is "user"

  Scenario: A project scope is found by walking up
    Given a home directory containing a user scope
    And a project at "work/app" containing a project scope
    And the working directory is "work/app/src/deep"
    When the scopes are resolved
    Then the chain is "project, user, builtin"
    And the default write scope is "project"

  Scenario: The home directory is never treated as a project
    Given a home directory containing a user scope
    And the working directory is inside the home directory
    When the scopes are resolved
    Then the chain is "user, builtin"
    And the project scope is not the user scope

  Scenario: A scope that declares itself a user scope is skipped
    Given a shared directory whose .factory declares scope "user"
    And the working directory is below that shared directory
    When the scopes are resolved
    Then no project scope is found

  Scenario: Discovery stops at the repository boundary
    Given a project at "work/outer" containing a project scope
    And a git repository at "work/outer/inner" with no scope of its own
    And the working directory is "work/outer/inner/src"
    When the scopes are resolved
    Then no project scope is found

  Scenario: FACTORY_HOME relocates the user scope
    Given FACTORY_HOME points at a directory "elsewhere"
    And a working directory outside any project
    When the scopes are resolved
    Then the user scope root is "elsewhere"

  Scenario: FACTORY_SCOPES replaces the whole chain
    Given FACTORY_SCOPES lists two scope directories
    When the scopes are resolved
    Then the chain has 2 scopes
    And no builtin scope is present

  Scenario: The built-in scope is read-only
    Given a home directory containing a user scope
    And a working directory outside any project
    When the scopes are resolved
    Then the builtin scope is not writable
    And writing to the builtin scope is refused

  Scenario: The nearest repository is reported even when it has no scope
    Given a git repository at "work/app" with no scope of its own
    And the working directory is "work/app/src"
    When the scopes are resolved
    Then no project scope is found
    And the reported git root ends with "work/app"

  Scenario: a packaged build can say where the built-ins are
    Given a directory of definitions that ships inside an application
    And FACTORY_BUILTIN_ROOT points at it
    When scopes are resolved
    Then the builtin scope is that directory
    And it is still read-only

  Rule: a scope at the old path still works

    Factory keeps its files under `.xaedalon/` now, beside whatever else the
    family writes. Moving is the user's to do — their repository, and their
    database is inside it — so the old path is still read until they have.

    Not reading it would not be a small inconvenience: the daemon creates a
    database at whatever path the chain resolves, so an installation that moved
    underneath someone would show an empty board while every task and run sat
    unharmed where it had always been.

    Scenario: A project scope at the old path is still found
      Given a home directory containing a user scope
      And a project at "work" whose scope is at the old path
      And the working directory is "work/src"
      When the scopes are resolved
      Then the chain is "project, user, builtin"
      And the project scope is marked as legacy

    Scenario: The new path wins when a repository has both
      Given a home directory containing a user scope
      And a project at "work" whose scope is at the old path
      And that project also has a scope at the new path
      And the working directory is "work/src"
      When the scopes are resolved
      Then the project scope is at the new path
      And the project scope is not marked as legacy

    Scenario: A scope at the new path is not marked as legacy
      Given a home directory containing a user scope
      And a project at "work" containing a project scope
      And the working directory is "work/src"
      When the scopes are resolved
      Then the project scope is not marked as legacy
