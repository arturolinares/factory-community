Feature: Plugin conformance
  One suite that every plugin must pass, whoever wrote it. Xaedalon Factory Pro
  runs exactly this, and so does a third-party provider plugin.

  That equivalence is the enforcement. If Pro ever needed a check relaxed, the
  plugin contract would be too narrow -- the fix is to widen the SDK, never to
  exempt the commercial edition.

  Scenario: A well-formed plugin passes
    Given a plugin "acme-tools" providing the "step-kind" capability "http"
    When conformance is checked
    Then the plugin conforms
    And the report says it provides "step-kind:http"

  Scenario: A plugin that only registers a hook still conforms
    Given a plugin "acme-policy" that registers only a "validateDefinition" hook
    When conformance is checked
    Then the plugin conforms
    And the report says it registers the "validateDefinition" hook

  Scenario: A plugin that contributes nothing fails
    Given a plugin "inert" that registers nothing
    When conformance is checked
    Then the plugin does not conform
    And the failing check is "registers without throwing"

  Scenario: A plugin with an invalid capability id fails
    Given a plugin "shouty" providing the "step-kind" capability "HTTP"
    When conformance is checked
    Then the plugin does not conform

  Scenario: A plugin with no version fails
    Given a plugin "acme-tools" providing the "step-kind" capability "http" with no version
    When conformance is checked
    Then the plugin does not conform
    And the failing check is "has a version"

  Scenario: A plugin holding module-level state fails the fresh-host check
    Given a plugin "leaky" that only registers its capability the first time
    When conformance is checked
    Then the plugin does not conform
    And the failing check is "registers identically into a fresh host"

  Scenario: The throwing form reports every failing check
    Given a plugin "inert" that registers nothing
    When conformance is asserted
    Then the assertion throws
    And the message names the plugin
