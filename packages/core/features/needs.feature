Feature: A workflow says what must come before it

  `verify` reads three artifacts that `analysis`, `design` and `validate` write.
  Nothing recorded that, so ticking `verify` on a task got you a workflow whose
  prompt pointed at files nothing had produced.

  A workflow names only its immediate predecessor and Factory walks the chain.
  The alternative — every workflow listing the whole chain — means writing the
  same order once per stage and repairing all of them the day a stage is
  inserted, and the copy nobody opens is the one that goes stale.

  Scenario: A workflow with no needs is left exactly as it was
    Given "analysis" needs nothing
    When I ask for "analysis"
    Then the list is "analysis"
    And nothing was added

  Scenario: Asking for the last one pulls in the whole chain
    Given the chain analysis, design, implement, validate, verify
    When I ask for "verify"
    Then the list is "analysis, design, implement, validate, verify"
    And "analysis, design, implement, validate" were added

  Scenario: A predecessor always lands before the thing that needs it
    Given the chain analysis, design, implement, validate, verify
    When I ask for "verify"
    Then "analysis" comes before "design"
    And "validate" comes before "verify"

  Scenario: What is already there is not added twice
    Given the chain analysis, design, implement, validate, verify
    When I ask for "implement, verify"
    Then the list is "analysis, design, implement, validate, verify"
    And "implement" appears once

  Scenario: An entry already in the list is not moved
    Given the chain analysis, design, implement, validate, verify
    When I ask for "analysis, verify"
    Then the list is "analysis, design, implement, validate, verify"
    And only "design, implement, validate" were added

  Scenario: Two dependents sharing a predecessor get one copy of it
    Given "left" needs "shared"
    And "right" needs "shared"
    And "shared" needs nothing
    When I ask for "left, right"
    Then the list is "shared, left, right"
    And "shared" appears once

  Rule: a ring is caught, not followed

    Each file knows one hop, so no amount of validating a single workflow finds
    a cycle. Resolution is the only place it can be seen — and the only place
    that would otherwise recurse for ever.

    Scenario: A workflow that needs itself around a ring is reported
      Given "a" needs "b"
      And "b" needs "c"
      And "c" needs "a"
      When I ask for "a"
      Then it is refused as a cycle
      And the problem names the ring

    Scenario: A ring does not hang
      Given "a" needs "b"
      And "b" needs "a"
      When I ask for "a"
      Then it is refused as a cycle

  Rule: a name that resolves to nothing is reported, and the rest still assembles

    Scenario: An unknown predecessor is named
      Given "design" needs "analysis"
      And "analysis" does not exist
      When I ask for "design"
      Then a problem names "analysis" as missing

    Scenario: The rest of the list is still assembled
      Given "design" needs "analysis"
      And "analysis" does not exist
      When I ask for "design"
      Then the list still contains "design"

  Rule: a list can be checked without being repaired

    The builder assembles a correct list. This is for saying so about one that
    was assembled some other way — by the API, by hand, or before a predecessor
    existed. A task's list is a plan somebody wrote, so it is reported on.

    Scenario: A predecessor that comes after its dependent is out of order
      Given the chain analysis, design, implement, validate, verify
      When I check the order of "verify, validate"
      Then "verify" is reported as needing "validate" later in the list

    Scenario: A predecessor that is absent entirely is reported too
      Given the chain analysis, design, implement, validate, verify
      When I check the order of "verify"
      Then "verify" is reported as missing "validate"

    Scenario: A correctly ordered list reports nothing
      Given the chain analysis, design, implement, validate, verify
      When I check the order of "analysis, design, implement, validate, verify"
      Then nothing is out of order

  Rule: a duplicate the person asked for is kept

    A task may legitimately run the same workflow twice — tests, a fix, tests
    again. Only the predecessors this resolution adds are de-duplicated.

    Scenario: The same workflow asked for twice stays twice
      Given "hello" needs nothing
      When I ask for "hello, hello"
      Then the list is "hello, hello"
      And nothing was added

    Scenario: A shared predecessor is still added only once
      Given the chain analysis, design, implement, validate, verify
      When I ask for "verify, verify"
      Then "verify" appears twice
      And "validate" appears once
