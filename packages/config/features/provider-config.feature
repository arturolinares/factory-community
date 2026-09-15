Feature: Telling Factory where the agent is
  Discovery covers the ordinary cases — PATH, then the handful of places things
  are usually installed. This covers everything else, which on somebody else's
  computer is a category that always turns out to be non-empty: a binary in a
  home-grown location, a nightly build being trialled, a repository that needs
  one exact version.

  It resolves through the same chain as definitions, so a user scope can say
  where this machine keeps things and a project scope can pin an exact binary
  for that repository. Project wins, as everywhere else.

  Background:
    Given a project scope and a user scope

  Scenario: nothing configured, nothing to apply
    When the provider settings are read
    Then no provider is configured

  Scenario: the user scope says where the binary is
    Given the user scope configures "claude" as "/opt/agents/claude"
    When the provider settings are read
    Then "claude" resolves to "/opt/agents/claude"

  Scenario: the project scope wins
    Given the user scope configures "claude" as "/opt/agents/claude"
    And the project scope configures "claude" as "/repo/bin/claude"
    When the provider settings are read
    Then "claude" resolves to "/repo/bin/claude"

  Scenario: a relative path belongs to the scope that wrote it
    Given the project scope configures "claude" as "./bin/claude"
    When the provider settings are read
    Then "claude" resolves to "bin/claude" inside the project scope

  Scenario: two providers, two scopes
    Given the user scope configures "codex" as "/opt/agents/codex"
    And the project scope configures "claude" as "/repo/bin/claude"
    When the provider settings are read
    Then "claude" resolves to "/repo/bin/claude"
    And "codex" resolves to "/opt/agents/codex"

  Scenario: nonsense is ignored rather than fatal
    Given the user scope configures "claude" with an empty command
    When the provider settings are read
    Then no provider is configured

  Scenario: a config that will not parse does not stop the others
    Given the project scope has a config that is not valid YAML
    And the user scope configures "claude" as "/opt/agents/claude"
    When the provider settings are read
    Then "claude" resolves to "/opt/agents/claude"
