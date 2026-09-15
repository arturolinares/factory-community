Feature: Step kinds come from the registry
  A phase step names its kind with "uses:", and the valid kinds are whatever is
  registered -- not a list core owns.

  That is the difference between an extensible core and one that merely says it
  is. If core held a fixed union of shell and agent, adding "uses: http" would
  need a core change, and the open-core promise would be decoration. The two
  built-in kinds are registered through the same plugin contract a third party
  uses, so the seam is exercised by default rather than only by outsiders.

  Background:
    Given the built-in step kinds are registered

  Scenario: The shorthand needs no "uses:"
    Given the phase YAML:
      """
      name: build
      steps: [{run: npm test}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 uses "shell"
    And step 0 runs "npm test"

  Scenario: Naming the kind explicitly is equivalent
    Given the phase YAML:
      """
      name: build
      steps: [{uses: shell, run: npm test}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 uses "shell"
    And step 0 runs "npm test"

  Scenario: An unknown step kind is rejected and says what is installed
    Given the phase YAML:
      """
      name: build
      steps: [{uses: http, url: https://example.com}]
      """
    When the phase is parsed
    Then parsing fails
    And a problem mentions "Unknown step kind"
    And a problem lists the installed kinds

  Scenario: A step naming no kind at all is rejected
    Given the phase YAML:
      """
      name: build
      steps: [{prompt: do something}]
      """
    When the phase is parsed
    Then parsing fails
    And a problem mentions "uses:"

  Scenario: A plugin adds a step kind and phases can use it, with no core change
    Given a plugin registers a "http" step kind requiring a "url"
    And the phase YAML:
      """
      name: build
      steps: [{uses: http, url: https://example.com}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 uses "http"

  Scenario: A plugin's step kind validates its own fields
    Given a plugin registers a "http" step kind requiring a "url"
    And the phase YAML:
      """
      name: build
      steps: [{uses: http}]
      """
    When the phase is parsed
    Then parsing fails
    And a problem names the field "steps.0.url"

  Scenario: A plugin can bring its own shorthand
    Given a plugin registers a "http" step kind requiring a "url"
    And the phase YAML:
      """
      name: build
      steps: [{url: https://example.com}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 uses "http"

  Scenario: Extension fields on a step are preserved
    Given the phase YAML:
      """
      name: build
      steps: [{run: npm test, x-timeout: 60}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 keeps the extension "x-timeout"

  Scenario: An agent step keeps its provider, model and session
    Given the phase YAML:
      """
      name: analysis
      steps: [{uses: agent, provider: claude, prompt: Analyse this, model: strong, session: workflow}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 uses "agent"
    And step 0 has provider "claude"
    And step 0 has model "strong"
    And step 0 has session "workflow"

  Scenario: Retries are a field of every kind, not of any one kind
    Given the phase YAML:
      """
      name: build
      steps: [{run: npm test, retries: 2, retry_delay: 5}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 retries 2 times
    And step 0 waits 5 seconds between attempts

  Scenario: A plugin's kind is retryable without knowing what a retry is
    Given a plugin providing the "http" kind
    And the phase YAML:
      """
      name: fetch
      steps: [{uses: http, url: https://example.com, retries: 1}]
      """
    When the phase is parsed
    Then parsing succeeds
    And step 0 retries 1 times

  Scenario: Retries must be a number of attempts
    Given the phase YAML:
      """
      name: build
      steps: [{run: npm test, retries: lots}]
      """
    When the phase is parsed
    Then parsing fails
    And a problem names the field "retries"

  Rule: an agent step may name an agent instead of spelling one out

    Provider, model and effort were retyped into every step, so changing which
    model does the work meant editing every phase that mentioned it. A named
    agent is that answer written once.

    Scenario: "agent:" alone is shorthand for an agent step
      Given the phase YAML:
        """
        name: build
        steps: [{agent: developer, prompt: Do the thing}]
        """
      When the phase is parsed
      Then parsing succeeds
      And step 0 uses "agent"
      And step 0 names the agent "developer"

    Scenario: A step that spells it out still works
      Given the phase YAML:
        """
        name: build
        steps: [{uses: agent, provider: claude, model: strong, prompt: Do the thing}]
        """
      When the phase is parsed
      Then parsing succeeds
      And step 0 uses "agent"

    Scenario: A step may name an agent and still override one setting
      Given the phase YAML:
        """
        name: build
        steps: [{agent: developer, effort: high, prompt: Do the thing}]
        """
      When the phase is parsed
      Then parsing succeeds
      And step 0 names the agent "developer"

  Rule: an artifact is a name, not a path

    Always Markdown and always in the task's own directory, so a name is the
    whole of it. Anything that looks like a path is refused rather than quietly
    creating a file somewhere nobody meant.

    Scenario: An agent step names the document it will write
      Given the phase YAML:
        """
        name: build
        steps: [{uses: agent, artifact: analysis, prompt: Work it out}]
        """
      When the phase is parsed
      Then parsing succeeds
      And step 0 promises the artifact "analysis"

    Scenario: A filename is not a name
      Given the phase YAML:
        """
        name: build
        steps: [{uses: agent, artifact: analysis.md, prompt: Work it out}]
        """
      When the phase is parsed
      Then parsing fails
      And a problem mentions "artifact"

    Scenario: A path is certainly not a name
      Given the phase YAML:
        """
        name: build
        steps: [{uses: agent, artifact: ../escape, prompt: Work it out}]
        """
      When the phase is parsed
      Then parsing fails

    Scenario: A shell step cannot promise one
      Given the phase YAML:
        """
        name: build
        steps: [{run: npm test, artifact: verify}]
        """
      When the phase is parsed
      Then parsing fails
      And a problem mentions "artifact"

  Rule: a step does not decide where it runs

    Scenario: A shell step cannot set its own working directory
      Given the phase YAML:
        """
        name: build
        steps: [{run: npm test, working_dir: web}]
        """
      When the phase is parsed
      Then parsing fails
      And a problem mentions "working_dir"
