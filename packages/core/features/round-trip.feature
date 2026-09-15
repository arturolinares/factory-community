Feature: Definitions survive a read-modify-write untouched
  Factory edits files that people wrote by hand, and it edits them on every
  save from the builder. Changing one field must never drop another, reorder
  keys, or delete a comment.

  The prototype failed all three: its writer rebuilt the document from a hand-
  typed literal, so saving discarded conditions and on_fail, and appending a
  workflow name to a project file destroyed every comment in it. The rule that
  replaces that is structural — an edit patches the author's own document, and
  only the canonical writer ever builds a file from scratch.

  Scenario Outline: A no-op save changes nothing at all
    Given the fixture "<fixture>"
    When it is parsed and written back with no changes
    Then the file is byte-for-byte unchanged

    Examples:
      | fixture                         |
      | full-featured.workflow.yaml     |
      | minimal.workflow.yaml           |
      | explicit-defaults.workflow.yaml |

  Scenario: Editing one field preserves comments, order and every other field
    Given the fixture "full-featured.workflow.yaml"
    When the description is changed to "Rewritten."
    Then the description is "Rewritten."
    And the comment "# The development pipeline." is still present
    And the comment "# used by the deploy step" is still present
    And the on-fail workflow is still "development-failure"
    And the conditions still require "hasWorktree"
    And the key order is unchanged

  Scenario: A value written explicitly is kept even when it equals the default
    Given the fixture "explicit-defaults.workflow.yaml"
    When it is parsed and written back with no changes
    Then the file still contains "mode: once"
    And the file still contains "scheduling: parallel"

  Scenario: The canonical writer omits values that equal the default
    Given the fixture "explicit-defaults.workflow.yaml"
    When it is written from scratch by the canonical writer
    Then the output does not contain "mode: once"
    And the output does not contain "scheduling: parallel"
    And the output contains "name: release"

  Scenario: Removing a field deletes its key
    Given the fixture "full-featured.workflow.yaml"
    When the on-fail workflow is removed
    Then the file no longer contains "on_fail"
    And the comment "# The development pipeline." is still present

  Scenario: A phase round-trips its steps, including the agent step
    Given the fixture "full-featured.phase.yaml"
    When it is parsed and written back with no changes
    Then the file is byte-for-byte unchanged

  Scenario: Updating refuses to touch a file that does not parse
    Given a file that is not valid YAML
    When an update is attempted
    Then the update is refused
