Feature: Round-tripping holds for values nobody thought to write a test for
  The example-based scenarios cover the shapes we imagined. These generate
  thousands we did not, and the string alphabet is seeded with the values that
  actually break YAML round-trips.

  That seeding is not hypothetical. The prototype's backlog records a real
  incident where a single unquoted "[ ! -d dist ]" in an action failed silently,
  and YAML 1.1 would read "yes", "no" and "0755" as a boolean, a boolean and an
  octal — turning a shell command into something else entirely on the way back
  out.

  Scenario: A workflow survives being written and read back
    When 500 arbitrary workflows are written and parsed again
    Then every one is identical to what was written

  Scenario: A phase survives being written and read back
    When 500 arbitrary phases are written and parsed again
    Then every one is identical to what was written

  Scenario: Writing is idempotent
    When 200 arbitrary workflows are written twice
    Then the second output equals the first

  Scenario: Updating a canonical file changes nothing
    When 200 arbitrary workflows are written and then updated with no changes
    Then the file is unchanged every time

  Scenario Outline: Awkward command strings survive a round trip
    Given a phase whose only step runs <command>
    When the phase is written and parsed again
    Then the step still runs exactly <command>

    Examples:
      | command                          |
      | "[ ! -d dist ] && npm run build" |
      | "yes"                            |
      | "no"                             |
      | "0755"                           |
      | "1.0"                            |
      | "null"                           |
      | "~"                              |
      | "#not-a-comment"                 |
      | "a: b"                           |
      | "- dash"                         |
      | "  padded  "                     |
      | "*anchor"                        |
      | "&ref"                           |
      | "%directive"                     |
      | "@at"                            |
      | "line one\nline two"             |
      | "trailing space "                |
      | "'single'"                       |
      | "\"double\""                     |
