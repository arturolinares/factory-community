Feature: Doctor answers for the installation itself

  Three rules about the files that decide what Factory loads. Two are new
  because a page can now switch a plugin off, and one is a promise the code had
  been making and not keeping.

  Background:
    Given the built-in doctor rules are registered

  Rule: a scope config that does not parse said nothing at all

    `declaredPlugins` and `providerSettings` both swallow a YAML error and
    carry on, which is right — a broken config must not stop Factory starting.
    Both said so in a comment claiming doctor would report it. No such rule
    existed, so a syntax error silently disabled that scope's plugins *and* its
    provider settings, and the first sign was a plugin that had stopped
    loading.

    Scenario: A config that is not valid YAML is an error naming the file
      Given the user scope's config is not valid YAML
      When doctor runs
      Then it reports that the config could not be read
      And the problem names the config file
      And it says the scope's plugins are being ignored

    Scenario: A config that is a list rather than a mapping is reported too
      Given the user scope's config is a list
      When doctor runs
      Then it reports that nothing in the config is read

    Scenario: A config of comments only is fine
      Given the user scope's config is comments only
      When doctor runs
      # `factory init` writes exactly this, so it must not be a complaint.
      Then it reports nothing about the config

    Scenario: A config that parses is fine
      Given the user scope declares a plugin
      When doctor runs
      Then it reports nothing about the config

  Rule: what is switched off is said out loud

    Scenario: A plugin switched off is reported as a warning
      Given the plugin "@acme/thing" is switched off
      When doctor runs
      Then it warns that "@acme/thing" is switched off
      And it is a warning, not an error

    Scenario: One still loaded says a restart will unload it
      Given the plugin "@factory/config/builtin-doctor" is switched off
      When doctor runs
      # It is in this very host, because the host has no unload.
      Then the warning says restarting will unload it

    Scenario: With nothing switched off it says nothing
      When doctor runs
      Then it warns about nothing being switched off

    Scenario: An id nothing declares any more is reported separately
      Given the plugin "@acme/long-gone" is switched off
      When doctor runs
      Then it warns that "@acme/long-gone" is no longer declared
      And it says switching it on will forget it

    Scenario: A declared plugin that is switched off is not called unknown
      Given the user scope declares a plugin
      And that declared plugin is switched off
      When doctor runs
      Then it warns that it is switched off
      And nothing calls it unknown
