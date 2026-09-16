Feature: One task waiting for another

  `todolist`'s own PROJECT.md lists ten tasks with a dependency column, and it
  is a graph rather than a chain — "tasks 3 and 4 can run at the same time; so
  can 7 and 8". Factory had nowhere to put that, so the order lived in
  somebody's head and was enforced by queueing one task and watching.

  Not `resolveNeeds`, whose walk this borrows: that one relates workflow
  definitions within a single task's list, and a ring among *tasks* has to name
  tasks. Not flags either — those are keyed to one task and written only by the
  engine onto the task whose own run just finished, which is why nothing can
  ever set a flag another task reads.

  Pure, and takes its lookups as arguments, so the scheduler and the API share
  one answer rather than keeping two.

  Scenario: A task with no dependencies is ready
    Given no dependencies at all
    When I ask what "task-4" is waiting for
    Then its dependencies are met
    And it is waiting for nothing

  Scenario: A blocker that is done is met
    Given "task-4" depends on "task-2"
    And "task-2" is "done"
    When I ask what "task-4" is waiting for
    Then its dependencies are met

  Scenario: A blocker that has not run is waited for
    Given "task-4" depends on "task-2"
    And "task-2" is "draft"
    When I ask what "task-4" is waiting for
    Then it is waiting
    And it is waiting for "task-2"

  Scenario: A blocker that is running is waited for
    Given "task-4" depends on "task-2"
    And "task-2" is "running"
    When I ask what "task-4" is waiting for
    Then it is waiting

  Scenario: Every blocker has to be done
    Given "task-9" depends on "task-8"
    And "task-9" depends on "task-7"
    And "task-8" is "done"
    And "task-7" is "queued"
    When I ask what "task-9" is waiting for
    Then it is waiting
    And it is waiting for "task-7"
    And it is not waiting for "task-8"

  Scenario: The same blocker named twice is one blocker
    Given "task-4" depends on "task-2"
    And "task-4" depends on "task-2"
    And "task-2" is "draft"
    When I ask what "task-4" is waiting for
    Then it is waiting for exactly 1 task

  Rule: the blockers of a task are read in the order they were given

    Its own rule because two callers read it — the scheduler, to decide, and
    the API, to say what a task is waiting for — and both show the list to
    somebody. The order is the order the edges arrived in, so what the picker
    added last appears last.

    Scenario: The blockers come back in edge order
      Given "task-9" depends on "task-8"
      And "task-9" depends on "task-7"
      When I ask which tasks block "task-9"
      Then the blockers are "task-8, task-7"

    Scenario: A task nothing blocks has no blockers
      Given "task-9" depends on "task-8"
      When I ask which tasks block "task-1"
      Then there are no blockers

    Scenario: The same blocker twice is listed once
      Given "task-9" depends on "task-8"
      And "task-9" depends on "task-8"
      When I ask which tasks block "task-9"
      Then the blockers are "task-8"

  Rule: a blocker that can never finish is dead, not awaited

    A cancelled or failed blocker will never become done, so a dependent left
    in the queue would sit there for ever looking like it was about to run —
    which is the state the board exists to make obvious. One dead blocker
    settles the question however many others are merely in progress.

    Scenario: A cancelled blocker is dead
      Given "task-4" depends on "task-2"
      And "task-2" is "cancelled"
      When I ask what "task-4" is waiting for
      Then its dependencies are dead
      And the reason says it was cancelled

    Scenario: A blocked blocker is dead
      Given "task-4" depends on "task-2"
      And "task-2" is "blocked"
      When I ask what "task-4" is waiting for
      Then its dependencies are dead
      And the reason says it is blocked

    Scenario: Dead beats waiting
      Given "task-9" depends on "task-8"
      And "task-9" depends on "task-7"
      And "task-8" is "running"
      And "task-7" is "cancelled"
      When I ask what "task-9" is waiting for
      Then its dependencies are dead
      # Both are still reported: one is the reason it can never start, the
      # other is the reason it has not started yet, and a person fixing this
      # wants to see both.
      And it is waiting for "task-8"

    Scenario: A blocker that is not there at all is dead
      Given "task-4" depends on "task-2"
      And "task-2" does not exist
      # Deleting a task cascades its edges away, so this needs a hand-edited
      # database. Dead rather than ignored: silently starting would be worse.
      Then its dependencies are dead
      And the reason says it no longer exists

  Rule: archiving a finished task does not stall what follows it

    `archived` is reachable from `done` and from `draft`, so the state alone
    cannot tell "finished, then put away" from "put away without ever running".
    Tidying up must not stop the work.

    Scenario: A blocker archived after finishing is met
      Given "task-4" depends on "task-2"
      And "task-2" is "archived" and had finished
      When I ask what "task-4" is waiting for
      Then its dependencies are met

    Scenario: A blocker archived without finishing is dead
      Given "task-4" depends on "task-2"
      And "task-2" is "archived" and never finished
      When I ask what "task-4" is waiting for
      Then its dependencies are dead
      And the reason says it was archived without finishing

  Rule: the queue order puts blockers first and keeps parallel work parallel

    Scenario: A chain is ordered
      Given "task-2" depends on "task-1"
      And "task-3" depends on "task-2"
      When I ask for the order of "task-3", "task-1" and "task-2"
      Then the order is "task-1, task-2, task-3"

    Scenario: Tasks that do not depend on each other keep the order they were given
      Given "task-3" depends on "task-2"
      And "task-4" depends on "task-2"
      When I ask for the order of "task-4", "task-3" and "task-2"
      # The parallel pair todolist asks for. Neither depends on the other, so
      # they come out as the caller listed them rather than in whatever order a
      # set happened to iterate.
      Then the order is "task-2, task-4, task-3"

    Scenario: Todolist's real graph orders as the project describes it
      Given todolist's ten tasks and their dependencies
      When I ask for the order of all ten
      Then every task comes after everything it depends on
      And there are no problems

    Scenario: A blocker outside the set does not order it
      Given "task-4" depends on "task-2"
      When I ask for the order of "task-4" alone
      # Usually a blocker that is already done and so is not being queued.
      # Refusing to order a batch because of a task that finished last week
      # would make the button useless.
      Then the order is "task-4"
      And there are no problems

    Scenario: An order with nothing in it is not a problem
      Given no dependencies at all
      When I ask for the order of nothing
      Then the order is empty
      And there are no problems

  Rule: a ring is caught, not followed

    Only a walk can see a ring: each edge knows one hop, so no amount of
    checking a single task would ever find it.

    Scenario: A task depending on itself is refused
      Given "task-3" depends on "task-3"
      When I ask for the order of "task-3"
      Then it is refused as a ring
      And the problem names "task-3"

    Scenario: A ring of two is refused, and names both
      Given "task-3" depends on "task-4"
      And "task-4" depends on "task-3"
      When I ask for the order of "task-3" and "task-4"
      Then it is refused as a ring
      And the problem names "task-3"
      And the problem names "task-4"
      And the problem says a task cannot depend on itself however far around

    Scenario: A ring further around is refused
      Given "task-3" depends on "task-4"
      And "task-4" depends on "task-5"
      And "task-5" depends on "task-3"
      When I ask for the order of "task-3", "task-4" and "task-5"
      Then it is refused as a ring

    Scenario: A ring is reported once, not once per member
      Given "task-3" depends on "task-4"
      And "task-4" depends on "task-3"
      When I ask for the order of "task-3" and "task-4"
      Then exactly 1 problem is reported
