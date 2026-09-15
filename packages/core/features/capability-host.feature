Feature: The capability host
  Editions are capabilities, not forks. Core defines the machinery; anything
  else provides capabilities through one public contract. Core degrades by the
  absence of a capability and never asks which edition is running.

  Scenario: A plugin's capability is discoverable once loaded
    Given a plugin "acme-tools" providing the "step-kind" capability "http"
    When the plugin is loaded
    Then the host has a "step-kind" capability "http"
    And listing "step-kind" capabilities returns 1 entry
    And the "http" capability is attributed to "acme-tools"
    And the host reports "acme-tools" among its loaded plugins

  Scenario: A capability kind core has never heard of still loads
    Given a plugin "acme-desktop" providing the "desktop" capability "shell"
    When the plugin is loaded
    Then the host has a "desktop" capability "shell"
    And the host lists "desktop" among its capability kinds

  Scenario: An absent capability is simply absent
    Given no plugins are loaded
    Then the host does not have a "desktop" capability
    And getting the "desktop" capability returns nothing

  Scenario: Two plugins cannot claim the same capability id
    Given a plugin "acme-tools" providing the "step-kind" capability "http"
    And the plugin is loaded
    When a plugin "rival-tools" providing the "step-kind" capability "http" is loaded
    Then loading fails
    And the error names the plugin that already provides it

  Scenario: A plugin that fails partway registers nothing
    Given a plugin "half-broken" that provides "step-kind" capability "good" and then throws
    When the plugin is loaded
    Then loading fails
    And the host does not have a "step-kind" capability "good"
    And the host reports no loaded plugins

  Scenario: A plugin that contributes nothing is rejected
    Given a plugin "inert" that registers nothing
    When the plugin is loaded
    Then loading fails
    And the error explains that it cannot affect anything

  Scenario: A capability id that is not a slug is rejected
    Given a plugin "shouty" providing the "step-kind" capability "HTTP"
    When the plugin is loaded
    Then loading fails
    And the error mentions the invalid id

  Scenario: The same plugin cannot be loaded twice
    Given a plugin "acme-tools" providing the "step-kind" capability "http"
    And the plugin is loaded
    When the same plugin is loaded again
    Then loading fails
    And the error says it is already loaded

  Scenario: Getting a capability without an id returns the only one of its kind
    Given a plugin "acme-desktop" providing the "desktop" capability "shell"
    When the plugin is loaded
    Then getting the "desktop" capability returns "shell"

  Scenario: Getting a capability without an id is ambiguous when there are several
    Given a plugin "two-providers" providing the "provider" capabilities "claude" and "codex"
    When the plugin is loaded
    Then getting the "provider" capability returns nothing
    And listing "provider" capabilities returns 2 entries
