Feature: Plugins declared by a scope
  A project ships its plugins in its own repository, found through the same
  layered chain as its definitions. Cloning a repo gets you its step kinds and
  providers along with its workflows, with no separate install step.

  Nothing here is fatal. One broken entry in a project's config must not stop
  Factory from starting — otherwise the only way to diagnose it would be to
  hand-edit the file that Factory can no longer read for you.

  Scenario: A plugin declared by the project scope is loaded
    Given the project scope declares a plugin that adds a "http" step kind
    When the catalogue is loaded
    Then the plugin is loaded
    And the host has a "step-kind" capability "http"
    And there are no problems

  Scenario: A missing plugin file is reported, not thrown
    Given the project scope declares a plugin that does not exist
    When the catalogue is loaded
    Then no plugin is loaded
    And a problem names the plugin
    And the problem points at the scope config

  Scenario: A module with no plugin export is reported
    Given the project scope declares a module that exports nothing useful
    When the catalogue is loaded
    Then no plugin is loaded
    And a problem mentions the missing export

  Scenario: One broken plugin does not stop the others
    Given the project scope declares a plugin that does not exist
    And the project scope also declares a plugin that adds a "http" step kind
    When the catalogue is loaded
    Then the plugin is loaded
    And exactly 1 problem is reported

  Scenario: A scope with no plugins declared contributes none
    Given the project scope declares no plugins
    When the catalogue is loaded
    Then no plugin is loaded
    And there are no problems

  Rule: a plugin switched off is never imported

    "Disabled" has to mean *not loaded*, or it is not true: a plugin that is
    still registered is still running its doctor rules and still contributing
    its step kinds. So the catalogue is built before anything is imported, and
    the loader skips what is off.

    Scenario: A declared plugin that is switched off is never imported
      Given the project scope declares a plugin that writes a file when it loads
      And that plugin is switched off
      When the catalogue is loaded
      # The only honest test of "not imported" is a side effect that did not
      # happen. The module writes a file as it loads; the file is not there.
      Then the file it would have written is not there
      And it is listed as switched off
      And nothing was loaded

    Scenario: The same plugin left on does load, so the check above means something
      Given the project scope declares a plugin that writes a file when it loads
      When the catalogue is loaded
      Then the file it would have written is there

    Scenario: A declared plugin is named by its specifier
      Given the project scope declares a plugin that adds a "http" step kind
      When the catalogue is loaded
      # Its manifest name is only knowable after importing it, and not
      # importing it is the point. The user's key is the string the user typed.
      Then it is listed as "./plugins/http.mjs"
      And its name is known now that it has loaded

    Scenario: A built-in is named by its manifest name
      Given a built-in plugin "acme-builtin"
      When the catalogue is loaded
      Then it is listed as "acme-builtin"

    Scenario: An essential plugin stays on however the file was edited
      Given a built-in plugin "acme-builtin" that is essential
      And "acme-builtin" is switched off
      When the catalogue is loaded
      Then "acme-builtin" is listed as still on
      And it was loaded

    Scenario: An id nothing claims any more is kept and listed
      Given "@acme/long-gone" is switched off
      When the catalogue is loaded
      # Never prune somebody's file behind their back. It is listed so the
      # switch that turns it back on is somewhere a person can reach.
      Then "@acme/long-gone" is listed as unknown
      And "@acme/long-gone" is listed as switched off
