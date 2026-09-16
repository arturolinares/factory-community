Feature: What environment an agent's process gets

  `runStep` spawned every child with `{ ...process.env, ... }`. That made the
  runner the one thing below an entry point reaching for the ambient
  environment, in a codebase whose whole discipline is the opposite —
  `PluginContext.env` exists so that "a plugin that calls `process.env` cannot
  be tested against a machine it is not running on", and `CapabilityHost`
  defaults env to `{}` "never to the ambient environment". The eslint rule that
  enforces this covers `cwd`, `homedir` and `tmpdir`, and not `env`, which is
  how the gap stayed open.

  What it cost: every coding agent Factory started inherited every credential
  the daemon had — cloud keys, registry tokens, the SSH agent socket.

  A deny-list, not an allow-list. An allow-list is the safer instinct and the
  wrong answer: Factory does not know what a project's own tooling needs, and a
  Default profile that broke `npm test` on an unfamiliar repository would be
  switched off by everyone on their first afternoon. Over-matching is the
  acceptable direction of error, and two things make it survivable — a provider
  declares what it needs, and every withheld name is reported.

  Scenario: Ordinary variables are passed through
    Given the environment holds "PATH", "HOME", "LANG" and "CI"
    When the environment is built for a confined step
    Then all of them are passed through
    And nothing was withheld

  Scenario: Credentials are withheld
    Given the environment holds "GITHUB_TOKEN", "NPM_TOKEN" and "AWS_SECRET_ACCESS_KEY"
    When the environment is built for a confined step
    Then none of them is passed through
    And all three were withheld

  Scenario: An unset variable is not passed as the word "undefined"
    Given the environment holds "EDITOR" with no value
    When the environment is built for a confined step
    Then "EDITOR" is not passed through
    And nothing was withheld

  Rule: the shape of the name is what decides

    Segment-wise on underscores rather than as a substring search, so `TOKEN`
    catches `GITHUB_TOKEN` without catching `TOKENIZERS_PARALLELISM`. The list
    is exported, because it is the part most likely to need extending.

    Scenario: A name whose segment is a credential word is withheld
      Given the environment holds "SENTRY_TOKEN", "DB_PASSWORD" and "MY_SECRET_THING"
      When the environment is built for a confined step
      Then none of them is passed through

    Scenario: A name that merely contains the letters is kept
      Given the environment holds "TOKENIZERS_PARALLELISM" and "KEYBOARD_LAYOUT"
      When the environment is built for a confined step
      # The reason the match is segment-wise. A substring search would drop
      # both, and dropping a machine-learning flag as if it were a credential is
      # the kind of surprise that gets a safety feature turned off.
      Then all of them are passed through

    Scenario: A whole family is withheld by prefix
      Given the environment holds "AWS_REGION" and "AWS_PROFILE"
      When the environment is built for a confined step
      # Not credentials by name, but every member of this family is one or
      # points at one, and the region alone is enough to aim a leaked key.
      Then none of them is passed through

    Scenario: A name that is a credential without saying so is withheld
      Given the environment holds "SSH_AUTH_SOCK" and "DATABASE_URL"
      When the environment is built for a confined step
      # The socket is not a key; it is a handle to every key the user has
      # loaded, which is the same thing. A database URL regularly carries a
      # password inside it.
      Then none of them is passed through

    Scenario: An ending that is a credential is withheld whatever precedes it
      Given the environment holds "ANTHROPIC_API_KEY" and "SOMETHING_PRIVATE_KEY"
      When the environment is built for a confined step
      Then none of them is passed through

  Rule: a provider keeps what it needs to authenticate

    The sharpest edge in the whole profile: a coding agent's own credential is
    shaped exactly like a credential, so filtering it makes every run of that
    provider fail at once. The provider declares the exception in its
    descriptor, beside the flags it also declares, rather than core holding a
    list that every new provider would have to come and edit.

    Scenario: A declared variable survives the filter
      Given the environment holds "ANTHROPIC_API_KEY" and "GITHUB_TOKEN"
      And the step's provider declares that it needs "ANTHROPIC_API_KEY"
      When the environment is built for a confined step
      Then "ANTHROPIC_API_KEY" is passed through
      And "GITHUB_TOKEN" is not passed through
      And only "GITHUB_TOKEN" was withheld

    Scenario: A declaration is matched whatever case it is written in
      Given the environment holds "ANTHROPIC_API_KEY"
      And the step's provider declares that it needs "anthropic_api_key"
      When the environment is built for a confined step
      Then "ANTHROPIC_API_KEY" is passed through

    Scenario: A step with no provider keeps no credentials
      Given the environment holds "NPM_TOKEN"
      When the environment is built for a confined step
      # A shell step running the project's own tests has no business needing a
      # registry token under this profile. If it does, the withheld name is
      # reported rather than left to be guessed at.
      Then "NPM_TOKEN" is not passed through

  Rule: Full Access withholds nothing

    The profile's entire promise is that the agent gets what the user's own
    shell would get. Quietly holding something back would make it a third
    profile nobody asked for.

    Scenario: Nothing is filtered under Full Access
      Given the environment holds "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY" and "PATH"
      When the environment is built for an unconfined step
      Then all of them are passed through
      And nothing was withheld

    Scenario: An unset variable is still dropped under Full Access
      Given the environment holds "EDITOR" with no value
      When the environment is built for an unconfined step
      # Not a policy decision: that is what an unset variable means, and `spawn`
      # would otherwise be handed the string "undefined".
      Then "EDITOR" is not passed through

  Rule: what was withheld is said, and values never are

    A run that cannot reach a registry should take one look to diagnose, not an
    afternoon. A name is not a secret and is the only useful half.

    Scenario: The report names the variables, in order, and says how to fix it
      Given the environment holds "NPM_TOKEN" and "GITHUB_TOKEN"
      When the environment is built for a confined step
      And I ask what to tell the reader
      Then the report names "GITHUB_TOKEN" and "NPM_TOKEN"
      And the report counts two variables
      And the report mentions "passEnv"
      And the report mentions "Full Access"
      And the report contains no value
