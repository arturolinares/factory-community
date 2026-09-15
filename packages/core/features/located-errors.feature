Feature: Errors name a line and a column
  Everything below the file layer reports problems by field path. This is where
  a path becomes a position, so an error reads like a compiler's and not like a
  riddle.

  It matters more than it sounds. The prototype's backlog records real time lost
  to a single mis-quoted line in a YAML file, because the failure surfaced as an
  opaque message with no file, no line, and no field. "factory doctor" and the
  builder's inline diagnostics are both this plus a renderer.

  Scenario: A YAML syntax error is reported with its position
    Given the workflow file:
      """
      name: development
      phases: [unclosed
      """
    When the file is parsed
    Then parsing fails
    And a problem carries a position
    And a problem names the file
    And the problem rule is "yaml.syntax"

  Scenario: An invalid value points at the line that holds it
    Given the workflow file:
      """
      name: development
      description: fine
      mode: banana
      phases: []
      """
    When the file is parsed
    Then parsing fails
    And a problem is on line 3
    And a problem names the field "mode"

  Scenario: An unknown field points at the offending key
    Given the workflow file:
      """
      name: development
      description: fine
      phasez: []
      """
    When the file is parsed
    Then parsing fails
    And a problem is on line 3

  Scenario: A problem inside a step points into the step
    Given the phase file:
      """
      name: analysis
      description: fine
      steps: [{uses: agent, model: strong}]
      """
    When the phase file is parsed
    Then parsing fails
    And a problem is on line 3
    And a problem names the field "steps.0.prompt"

  Scenario: A missing required field is reported against the file
    Given the workflow file:
      """
      description: no name here
      """
    When the file is parsed
    Then parsing fails
    And a problem names the field "name"

  Scenario: A value YAML read as a number explains how to keep it text
    Given the phase file:
      """
      name: build
      steps: [{run: 1.0}]
      """
    When the phase file is parsed
    Then parsing fails
    And a problem suggests quoting the value

  Scenario: A file that is not a mapping is rejected clearly
    Given the workflow file:
      """
      - name: development
      """
    When the file is parsed
    Then parsing fails
    And the problem rule is "yaml.notAMapping"
