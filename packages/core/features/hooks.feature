Feature: Hooks
  Hooks are where a plugin may influence an operation while it runs, as opposed
  to events, which report what already happened and cannot be changed.

  Two shapes, and they treat a broken plugin differently on purpose. A collect
  hook is gathering problems for a human to read, so one bad plugin must not
  hide the real errors. A transform hook is deciding what gets written, so a
  bad plugin must stop the write rather than let it proceed unreviewed.

  Scenario: Every collect hook runs and the results are concatenated
    Given a "validateDefinition" hook from "linter-a" reporting 1 problem
    And a "validateDefinition" hook from "linter-b" reporting 2 problems
    When a definition is validated
    Then 3 problems are collected

  Scenario: A collect hook that throws does not hide the other results
    Given a "validateDefinition" hook from "broken" that throws
    And a "validateDefinition" hook from "linter-b" reporting 2 problems
    When a definition is validated
    Then 3 problems are collected
    And one problem names the hook that threw

  Scenario: Transform hooks are chained in registration order
    Given a "beforeDefinitionWrite" hook from "first" that renames the definition to "one"
    And a "beforeDefinitionWrite" hook from "second" that appends "-two" to the name
    When a definition is written
    Then the write continues
    And the definition name is "one-two"

  Scenario: A rejection stops the chain
    Given a "beforeDefinitionWrite" hook from "policy" that rejects
    And a "beforeDefinitionWrite" hook from "later" that renames the definition to "unreachable"
    When a definition is written
    Then the write is rejected
    And the later hook did not run

  Scenario: A transform hook that throws rejects the write
    Given a "beforeDefinitionWrite" hook from "broken" that throws
    When a definition is written
    Then the write is rejected
    And the rejection names the hook that threw

  Scenario: With no hooks registered the value passes through unchanged
    Given no hooks are registered
    When a definition is written
    Then the write continues
    And the definition name is "original"

  Scenario: Hook contributors are reported
    Given a "validateDefinition" hook from "linter-a" reporting 1 problem
    And a "validateDefinition" hook from "linter-b" reporting 2 problems
    Then the contributors to "validateDefinition" are "linter-a" and "linter-b"
