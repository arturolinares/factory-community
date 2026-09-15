Feature: Seeing what is installed
  The list pages answer the question layered scopes create: there may be three
  copies of a name, and only one of them runs. Which scope a definition came
  from, and what it hides, are shown on every row rather than being something
  you go and ask for.

  Background:
    Given a project scope and a user scope

  Scenario: Workflows are listed with the scope they came from
    Given the project defines the workflow "development"
    When I open the workflows page
    Then the workflow "development" is listed
    And "development" shows the project scope

  Scenario: A definition that hides another says so
    Given the project defines the workflow "development"
    And the user also defines the workflow "development"
    When I open the workflows page
    Then the workflow "development" is listed once
    And "development" is marked as hiding the user scope

  Scenario: A definition that does not validate is still listed, and flagged
    Given the project defines a broken workflow "oops"
    When I open the workflows page
    Then the workflow "oops" is listed
    And "oops" is flagged as not validating

  Scenario: The built-in workflow appears when nothing hides it
    When I open the workflows page
    Then the workflow "hello-world" is listed
    And "hello-world" shows the builtin scope

  Scenario: Phases have their own page
    Given the project defines the phase "analysis"
    When I open the phases page
    Then the phase "analysis" is listed

  Scenario: An empty scope says what to do about it
    Given the project scope is empty
    And the builtin scope is excluded
    When I open the phases page
    Then the page says there is nothing yet

  Scenario: The scopes page shows the chain and where writes go
    When I open the scopes page
    Then the scope chain is "project, user, builtin"
    And the builtin scope is shown as read-only
    And the page says new definitions go to the project scope

  Scenario: The plugins page groups what is installed by the plugin that gave it
    When I open the plugins page
    Then "claude" is listed as an agent
    And "codex" is marked as having an unverified descriptor
    And the step kinds include "shell"
    And the two core built-ins cannot be switched off

  Scenario: A daemon that is not running says so plainly
    Given the daemon is not running
    When I open the workflows page
    Then the page says it cannot reach the daemon
