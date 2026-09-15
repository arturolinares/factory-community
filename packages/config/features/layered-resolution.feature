Feature: Which definition wins
  A name is looked up project first, then user, then built-in, and the first
  match wins. That is what lets a project override a shipped workflow without
  editing it, and a person keep their own without imposing it on the team.

  The cost of layering is that "which file am I actually running?" stops being
  obvious. So it is answered here rather than left to the user: every result
  carries what it shadows, and explain lists every path tried, in order,
  present or not.

  Scenario: The project copy wins and the user copy is reported as shadowed
    Given the user scope defines the workflow "development"
    And the project scope defines the workflow "development"
    When the workflow "development" is resolved
    Then it comes from the "project" scope
    And it shadows 1 definition
    And the shadowed definition is in the "user" scope

  Scenario: Resolution falls through to the user scope
    Given the user scope defines the workflow "development"
    When the workflow "development" is resolved
    Then it comes from the "user" scope
    And it shadows 0 definitions

  Scenario: Resolution is per name, not per scope
    Given the user scope defines the workflow "development"
    And the project scope defines the workflow "release"
    When the workflows are listed
    Then "development" resolves from the "user" scope
    And "release" resolves from the "project" scope

  Scenario: A name that exists nowhere resolves to nothing
    When the workflow "missing" is resolved
    Then nothing is found

  Scenario: Explaining a resolution lists every path tried
    Given the user scope defines the workflow "development"
    When the workflow "development" is explained
    Then 3 candidates are listed
    And the candidates are in order "project, user, builtin"
    And the "user" candidate exists
    And the "project" candidate does not exist

  Scenario: A file that fails to parse still wins
    Given the user scope defines the workflow "development"
    And the project scope defines a broken workflow "development"
    When the workflow "development" is resolved
    Then it comes from the "project" scope
    And it has problems
    And no value is produced

  Scenario: Listing marks every shadowed copy
    Given the user scope defines the workflow "development"
    And the project scope defines the workflow "development"
    When the workflows are listed
    Then "development" is listed exactly once
    And "development" is shadowed once

  Scenario: A phase resolves through the same chain
    Given the project scope defines the phase "analysis"
    When the phase "analysis" is resolved
    Then it comes from the "project" scope
    And the phase has 1 step

  Scenario: An agent resolves through the same chain
    Given the project scope defines the agent "developer"
    When the agent "developer" is resolved
    Then it comes from the "project" scope
    And the agent uses the "claude" provider

  Scenario: A project's agent shadows the user's
    Given the user scope defines the agent "developer" using codex
    And the project scope defines the agent "developer"
    When the agent "developer" is resolved
    Then it comes from the "project" scope
    And the agent uses the "claude" provider

  Scenario: The built-in workflow is found when nothing shadows it
    Given a chain that includes the built-in scope
    When the workflow "hello-world" is resolved
    Then it comes from the "builtin" scope
