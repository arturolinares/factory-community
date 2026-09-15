Feature: What is still missing
  Doctor answers "is anything wrong?" — a question you ask an installation that
  already works. This answers "what do I still need to do?", which is the
  question on the first day, and the two lists are not the same. No agent
  installed is not a fault; it is a step nobody has taken yet.

  It is a registry, so each part of Factory contributes what it knows: a
  provider plugin knows how its agent is installed, the engine knows whether a
  project has been added, Pro knows whether it is licensed. A plugin with setup
  of its own appears in the same list without this file changing.

  Background:
    Given a project scope and a user scope
    And the built-in setup steps are registered

  Scenario: a fresh machine with nothing installed
    Given no agent is installed
    When setup is checked
    Then "an-agent" is not done
    And it is marked essential
    And the installation is not ready

  Scenario: it says how to install each agent it knows about
    Given no agent is installed
    And a provider "claude" that documents how it is installed
    When setup is checked
    Then "an-agent" offers to install "Claude Code"
    And the offer carries the install command
    And the offer carries a link to its documentation

  Scenario: it offers the way out for an agent installed somewhere unusual
    Given no agent is installed
    And a provider "claude" that documents how it is installed
    When setup is checked
    Then "an-agent" offers to point Factory at an existing install
    And the offer shows the configuration to write

  Scenario: an installed agent finishes the step
    Given "claude" is installed and on PATH
    When setup is checked
    Then "an-agent" is done
    And the detail names "Claude Code"

  Scenario: the built-in workflows are not a pipeline
    Given no workflow of your own
    When setup is checked
    Then "a-workflow" is not done
    And it is not marked essential
    And it offers to import the example

  Scenario: a workflow of your own finishes the step
    Given the project defines a workflow "development"
    When setup is checked
    Then "a-workflow" is done

  Scenario: ready means nothing essential is outstanding
    Given "claude" is installed and on PATH
    And no workflow of your own
    When setup is checked
    Then the installation is ready
    And 1 step is still outstanding

  Scenario: a step that throws is reported rather than losing the list
    Given a plugin whose setup step throws
    And "claude" is installed and on PATH
    When setup is checked
    Then the broken step is reported as not done
    And the other steps are still listed
