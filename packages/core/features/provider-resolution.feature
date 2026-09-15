Feature: Finding the agent on this machine
  Factory runs the coding agents you already have, which makes "where is it?" a
  question about *your* machine — and the answer differs between two Macs owned
  by the same person. Homebrew puts things in `/opt/homebrew/bin` on Apple
  Silicon and `/usr/local/bin` on Intel; node tooling puts them under a version
  manager's shims; an application launched from Finder has almost no PATH at
  all.

  So the search is layered, and the order is the point: what you configured,
  then what your PATH says, then the places things are usually installed. A
  failure names every directory it tried, because "not found on PATH" leaves
  somebody with nowhere to go.

  Background:
    Given a provider "claude" whose command is "claude"

  Scenario: found on PATH
    Given "claude" is installed in "/usr/local/bin"
    And PATH contains "/usr/local/bin"
    When availability is checked
    Then it is available
    And the path found is "/usr/local/bin/claude"

  Scenario: found where things are usually installed, though PATH says nothing
    Given "claude" is installed in "/opt/homebrew/bin"
    And PATH is empty
    And "/opt/homebrew/bin" is one of the usual locations
    When availability is checked
    Then it is available
    And the path found is "/opt/homebrew/bin/claude"

  Scenario: PATH wins over the usual locations
    Given "claude" is installed in "/usr/local/bin"
    And "claude" is installed in "/opt/homebrew/bin"
    And PATH contains "/usr/local/bin"
    And "/opt/homebrew/bin" is one of the usual locations
    When availability is checked
    Then the path found is "/usr/local/bin/claude"

  Scenario: a configured command wins outright
    Given the provider's command is "/opt/agents/claude-nightly"
    And "claude-nightly" is installed in "/opt/agents"
    And PATH is empty
    When availability is checked
    Then it is available
    And the path found is "/opt/agents/claude-nightly"

  Scenario: a configured command that is not there says so plainly
    Given the provider's command is "/opt/agents/claude-nightly"
    And nothing is installed there
    When availability is checked
    Then it is not available
    And the reason names the configured path

  Scenario: a file that is not executable does not count
    Given "claude" exists in "/usr/local/bin" but cannot be executed
    And PATH contains "/usr/local/bin"
    When availability is checked
    Then it is not available

  Scenario: not found anywhere says where it looked
    Given PATH contains "/usr/bin"
    And "/opt/homebrew/bin" is one of the usual locations
    When availability is checked
    Then it is not available
    And the reason names "/usr/bin"
    And the reason names "/opt/homebrew/bin"
    And the reason says how to configure the path
    And every directory tried is reported

  Scenario: a long search is summarised rather than listed in full
    Given PATH contains 12 directories
    When availability is checked
    Then the reason mentions the first few and counts the rest
    And every directory tried is still reported

  Scenario: a directory listed twice is searched once
    Given PATH contains "/usr/local/bin" twice
    And "/usr/local/bin" is one of the usual locations
    When availability is checked
    Then "/usr/local/bin" was searched once

  Rule: discovery describes a machine, so it needs one described

    Scenario: an environment that says nothing is not searched
      Given an environment with no HOME and no PATH
      When the usual locations are listed
      Then there are none

    Scenario: an agent on PATH is run by name
      Given "claude" is installed in "/usr/local/bin"
      And PATH contains "/usr/local/bin"
      When the command is resolved
      Then the command stays "claude"

    Scenario: an agent found off PATH is run by its full path
      Given a home directory with "claude" in ".local/bin"
      And PATH is empty
      When the command is resolved
      Then the command is the full path to it

    Scenario: an agent nowhere to be found is left alone
      Given an environment with a home directory and nothing installed
      When the command is resolved
      Then the command stays "claude"

    Scenario: a configured absolute command is never second-guessed
      Given the provider's command is "/opt/agents/claude-nightly"
      When the command is resolved
      Then the command stays "/opt/agents/claude-nightly"


  Rule: the fix names a file that exists, not a path we assume

    The reason used to end "set providers.claude.command in your .factory/config.yaml",
    a literal written once and left behind the moment the scope directory moved
    to .xaedalon/.factory — sending someone to a path that is not on their disk.
    The caller knows where the file is; it passes it in.

    Scenario: the caller's config file is the one named
      Given PATH contains "/usr/bin"
      And the caller knows the config file is "/home/someone/.xaedalon/.factory/config.yaml"
      When availability is checked
      Then it is not available
      And the reason names "/home/someone/.xaedalon/.factory/config.yaml"

    Scenario: with no config file the reason still says what to set
      Given PATH contains "/usr/bin"
      When availability is checked
      Then it is not available
      And the reason says how to configure the path
      And the reason names no scope directory

  Rule: the search is a question about a command, not about a provider

    The probe was written for agent CLIs, and then a plugin wanted to ask the
    same thing about its own binary — is `diffity` installed, and if not, where
    did you look. So the walk is `commandAvailability` and the provider's
    wording of it is `availability`, which supplies whose command it is and the
    config key that fixes it.

    Every scenario above still passes unchanged, which is what proves the
    wording moved and the answer did not. These are the half a provider no
    longer owns.

    Scenario: a bare command found on PATH
      Given "diffity" is installed in "/usr/local/bin"
      And PATH contains "/usr/local/bin"
      When the command "diffity" is probed
      Then it is available
      And the path found is "/usr/local/bin/diffity"

    Scenario: a command that is nowhere carries the caller's own advice
      Given PATH contains "/usr/bin"
      And the caller's advice is "Install it with npm install -g diffity."
      When the command "diffity" is probed
      Then it is not available
      And the reason names "/usr/bin"
      And the reason ends with the caller's advice

    Scenario: with no advice the reason is just where it looked
      Given PATH contains "/usr/bin"
      When the command "diffity" is probed
      Then it is not available
      # No invented config key: a provider has one to name and a tool does not.
      And the reason says nothing about configuring anything

    Scenario: the usual locations are the caller's to supply
      Given "diffity" is installed in "/opt/homebrew/bin"
      And PATH is empty
      And "/opt/homebrew/bin" is one of the usual locations
      When the command "diffity" is probed with the usual locations
      Then it is available
