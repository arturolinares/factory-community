Feature: A task, and the rules about how it moves
  A task is the thing that outlives the command that created it. Everything the
  board shows, the scheduler picks up and the engine runs is a task in some
  state, so the rules about which state can follow which are the part that has
  to be obviously right.

  They live in one place for a specific reason. In the prototype, approve,
  retry, run, archive and the scheduler each called transition() with their own
  surrounding logic, and the interface re-encoded the same rules as scattered
  conditionals. The two drifted, and the bug that followed let a blocked task be
  started in a way nothing had anticipated. Here there is one table of moves,
  one function that applies them, and a published list of what is currently
  allowed so no client has to re-derive any of it.

  Background:
    Given an empty store

  Scenario: A new task starts as a draft
    When I create a task "Add due dates"
    Then the task is "draft"
    And its history is empty

  Scenario: A draft with no workflows cannot be queued
    When I create a task "Add due dates"
    Then "queue" is not offered

  Scenario: Assigning a workflow makes it queueable
    Given a task "Add due dates"
    When I assign the workflow "development"
    Then "queue" is offered

  Scenario: Queueing puts it in line
    Given a task "Add due dates" with the workflow "development"
    When I queue it
    Then the task is "queued"
    And it has a place in the queue

  Scenario: Tasks queue behind each other
    Given a task "First" with the workflow "development"
    And a task "Second" with the workflow "development"
    When I queue "First"
    And I queue "Second"
    Then "Second" is behind "First" in the queue

  Scenario: Every transition is recorded
    Given a task "Add due dates" with the workflow "development"
    When I queue it
    Then its history has 1 entry
    And the entry says it went from "draft" to "queued"

  Scenario: A blocked task records why
    Given a running task
    When it is blocked because "the tests failed"
    Then the task is "blocked"
    And the reason is "the tests failed"

  Scenario: Retrying clears the reason
    Given a running task
    And it is blocked because "the tests failed"
    When I retry it
    Then the task is "queued"
    And there is no reason recorded

  Scenario: A finished task can be run again
    Given a running task
    When it completes
    Then the task is "done"
    And it has a completion time
    When I queue it again
    Then the task is "queued"
    And it no longer has a completion time

  Scenario: An action the state does not allow is refused
    Given a task "Add due dates" with the workflow "development"
    When I try to approve it
    Then it is refused
    And the error says what is available instead

  Scenario: The available actions depend on the state
    Given a task "Add due dates" with the workflow "development"
    Then the offered actions are "archive, cancel, queue"
    When I queue it
    Then the offered actions are "cancel"

  Scenario: Internal actions are not offered to a person
    Given a task "Add due dates" with the workflow "development"
    When I queue it
    Then "start" is not offered

  Scenario: A task awaiting approval can be approved or rejected
    Given a task awaiting approval
    Then the offered actions are "approve, cancel, reject"

  Scenario: Approving resumes it
    Given a task awaiting approval
    When I approve it
    Then the task is "running"

  Scenario: Rejecting blocks it
    Given a task awaiting approval
    When I reject it
    Then the task is "blocked"

  Scenario: Archiving hides it from the board
    Given a task "Add due dates" with the workflow "development"
    When I archive it
    Then the task is "archived"
    And it is not in the default listing
    And it is in the listing that includes archived tasks

  Scenario: A restored task comes back as a draft
    Given a task "Add due dates" with the workflow "development"
    And it is archived
    When I restore it
    Then the task is "draft"

  Scenario: Cancelling is possible from anywhere that is still live
    Given a running task
    When I cancel it
    Then the task is "cancelled"

  Scenario: A transition and its history are written together
    Given a task "Add due dates" with the workflow "development"
    When a transition fails partway
    Then no history was recorded

  Rule: Editing the list keeps what each entry already knows

    This used to be the opposite. Progress was a position in the list, so any
    edit — even a reorder — sent the task back to the first workflow, because
    position 2 means nothing once the list has changed. Fixing a failure almost
    always means touching the task, so the cost of that landed exactly when it
    hurt most.

    Entries carry their own state now, and an edit carries it across.

    Scenario: Reordering keeps every entry's tick
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      When I put the same workflows in a different order
      Then "one" and "two" are still unticked
      And "three" is still ticked

    Scenario: Adding a workflow leaves the others alone
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      When I add "four" to the end
      Then "one" and "two" are still unticked
      And "four" is ticked

    Scenario: Saving an unedited list changes nothing
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      When I assign the same list of workflows
      Then "one" and "two" are still unticked

    Scenario: A workflow that has never run can be taken off
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      When I take "three" off the list
      Then the list is "one, two"

    Scenario: A workflow that has run cannot be taken off
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      When I take "two" off the list
      Then the change is refused
      And the refusal names "two"

    Scenario: Nothing is half-applied when a removal is refused
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      When I take "two" off the list
      Then the list is still "one, two, three"

  Rule: A workflow is ticked until the engine has finished with it

    Scenario: A new task has everything ticked
      Given a task "Add due dates" with the workflow "development"
      Then "development" is ticked

    Scenario: A task with nothing ticked cannot be queued
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      And "three" is unticked as well
      Then it cannot be queued

    Scenario: Ticking one back on makes it queueable again
      Given a task with "one", "two" and "three", of which "one" and "two" have run
      And "three" is unticked as well
      When I tick "one" back on
      Then it can be queued

  Rule: A task can be renamed without losing where its work lives

    `directory` is the task's identity on disk — the worktree was created at it
    and the daemon joins it with the project's worktree root to decide where
    steps run. Re-deriving it from a new name would move the workspace out from
    under work in progress and orphan the directory holding it.

    Scenario: Renaming changes the name
      Given a task "Add due dates" with the workflow "development"
      When I rename it to "Add due dates and times"
      Then the task is called "Add due dates and times"

    Scenario: Renaming leaves the directory alone
      Given a task "Add due dates" with the workflow "development"
      When I rename it to "Something else entirely"
      Then its directory is unchanged

    Scenario: A task cannot be renamed to nothing
      Given a task "Add due dates" with the workflow "development"
      When I rename it to "   "
      Then the rename is refused

  Rule: A task says what it is for, separately from what it is called

    A name is an identifier people search the board by; a description is the
    brief. Keeping them apart is what lets `{{ task.description }}` be pasted
    into a prompt without dragging the name's constraints along with it.

    Scenario: A task with no description has an empty one, not a missing one
      Given a task "Add due dates" with the workflow "development"
      Then its description is empty

    Scenario: Describing a task
      Given a task "Add due dates" with the workflow "development"
      When I describe it as "Every todo gets an optional due date, shown on the list."
      Then its description is "Every todo gets an optional due date, shown on the list."

    Scenario: A description can be cleared
      Given a task "Add due dates" described as "Something provisional"
      When I describe it as ""
      Then its description is empty

    Scenario: Renaming leaves the description alone
      Given a task "Add due dates" described as "Every todo gets an optional due date."
      When I rename it to "Something else entirely"
      Then its description is "Every todo gets an optional due date."

    Scenario: Describing leaves the name and the directory alone
      Given a task "Add due dates" with the workflow "development"
      When I describe it as "A brief."
      Then the task is called "Add due dates"
      And its directory is unchanged

  Rule: A task remembers the agent session its steps share

    The id is Factory's own choosing, which is what makes the conversation
    resumable exactly rather than by "the most recent one in this directory".
    Written here, read by the next run and by whoever opens a terminal.

    Scenario: A new task has no session
      Given the task "Add due dates" exists
      Then it carries no session

    Scenario: A session is written down and read back
      Given the task "Add due dates" exists
      When the session "s-1" for "claude" is recorded
      Then it carries the session "s-1"
      And the session belongs to "claude"

    Scenario: The first one recorded is the one it keeps
      Given the task "Add due dates" exists
      And the session "s-1" for "claude" is recorded
      When the session "s-2" for "claude" is recorded
      # A later run must not replace it: the second session would be missing
      # every phase the first one holds, and the task would resume into a
      # conversation that never saw its own earlier work.
      Then it carries the session "s-1"

    Scenario: A session for a task that is not there is an error
      When the session "s-1" is recorded for a task that does not exist
      Then it fails
