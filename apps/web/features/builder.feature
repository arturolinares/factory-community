Feature: Building a workflow without writing YAML
  The form is the point of the whole definition layer: authoring a workflow
  should not require knowing which fields exist, which values are legal, or
  where the file goes. The preview beside it shows the exact bytes that will be
  written — rendered by the process that writes them, so it cannot be a
  flattering approximation.

  Step editors come from the registry rather than a list in the builder, so a
  plugin's step kind gets real labelled controls with no change here. That is
  the difference between an extensible core and one that says it is.

  Background:
    Given a project scope and a user scope

  Scenario: A new workflow starts with somewhere to put it
    When I open the new workflow page
    Then the scope selector offers "project"
    And the target path is shown in full
    And the builtin scope cannot be chosen

  Scenario: Typing a name shows it in the preview
    When I open the new workflow page
    And I set the name to "release"
    Then the preview contains "name: release"

  Scenario: The interval field only exists for a loop
    When I open the new workflow page
    Then there is no interval field
    When I set the mode to "loop"
    Then there is an interval field

  Scenario: Every field the schema accepts reaches the file
    When I open the new workflow page
    And I set the name to "release"
    And I set the description to "Ship it."
    And I set scheduling to "sequential"
    And I add the phase "build"
    And I require the condition "hasWorktree"
    Then the preview contains "description: Ship it."
    And the preview contains "scheduling: sequential"
    And the preview contains "hasWorktree"

  Scenario: Saving writes the file and returns to the list
    When I open the new workflow page
    And I set the name to "release"
    And I add the phase "analysis"
    And I save
    Then I am back on the workflows list
    And the workflow "release" is listed

  Scenario: A name that is not a slug is refused with the reason
    When I open the new workflow page
    And I set the name to "Release Workflow"
    And I save
    Then the problem names the field "name"

  Scenario: Editing an existing workflow loads its values
    Given the project defines the workflow "development"
    When I open the workflow "development"
    Then the name field reads "development"
    And the preview contains "phases:"

  Scenario: Saving into a scope that hides another copy warns first
    Given the user defines the workflow "shared"
    And the project scope has no workflow "shared"
    When I open the new workflow page
    And I set the name to "shared"
    Then I am warned that saving will hide the user copy

  Scenario: A built-in definition is read-only and offers a fork
    When I open the workflow "hello-world"
    Then the target scope is not builtin
    And I am offered to fork it to a writable scope

  Scenario: A phase step gets fields generated from its own schema
    When I open the new phase page
    And I add a step
    Then the step kind can be chosen from the registry
    And the shell step shows a "run" field

  Scenario: Switching a step to an agent shows the agent's own fields
    When I open the new phase page
    And I add a step
    And I set the step kind to "agent"
    Then the step shows a "prompt" field
    And the step shows a "session" field offering "workflow"

  Scenario: A step kind from a plugin is editable with no builder change
    Given a plugin provides a "http" step kind requiring a "url"
    When I open the new phase page
    And I add a step
    And I set the step kind to "http"
    Then the step shows a "url" field
    And the step is marked as not runnable

  Scenario: Steps can be reordered
    When I open the new phase page
    And I set the name to "build"
    And I add a step running "first"
    And I add a step running "second"
    And I move the second step up
    Then the preview lists "second" before "first"

  Scenario: A phase saves with its steps
    When I open the new phase page
    And I set the name to "build"
    And I add a step running "npm test"
    And I save
    Then I am back on the phases list
    And the phase "build" is listed
