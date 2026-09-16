Feature: What Factory started, Factory can stop

  Cancelling a run used to flip a database row and nothing else. There were
  three separate reasons it could not work, and all three had to go: nothing
  held the child process, the child led no process group, and shutdown did not
  try.

  This is the first of those — one place that knows which processes belong to
  which run. The registry takes an interface rather than a `ChildProcess`, so
  the ordering rules can be exercised without spawning anything; and then one
  Rule does spawn something, because the claim being made is about
  *grandchildren* and no fake can be wrong about those in the same way a real
  process can.

  Scenario: A registered process is held against its run
    Given a process registered for run "r1"
    Then the registry holds 1 process
    And it holds 1 process for "r1"
    And "r1" is listed as running something

  Scenario: Forgetting a process releases the run
    Given a process registered for run "r1"
    When it is forgotten
    Then the registry holds nothing
    And nothing is listed as running

  Scenario: Two runs are held apart
    Given a process registered for run "r1"
    And a process registered for run "r2"
    When "r1" is stopped
    Then only "r1" got a signal
    And the registry still holds 2 processes

  Rule: polite first, then not

    A coding agent interrupted mid-write can leave a half-written file, so the
    grace period costs nothing when the process goes. Then SIGKILL, because a
    kill switch that can be ignored is not one.

    Scenario: A process that exits politely is never killed
      Given a process registered for run "r1" that exits on SIGTERM
      When "r1" is stopped
      Then it was sent SIGTERM
      And it was not sent SIGKILL
      And the report says 1 signalled and 0 killed

    Scenario: A process that ignores SIGTERM is killed
      Given a process registered for run "r1" that ignores signals
      When "r1" is stopped
      Then it was sent SIGTERM
      And the grace period was waited out first
      And it was sent SIGKILL
      And the report says 1 signalled and 1 killed

    Scenario: A process that had already gone is not reported as stopped
      Given a process registered for run "r1" that has already gone
      When "r1" is stopped
      # The difference between "the kill switch worked" and "there was nothing
      # to do", which a caller wants to be able to tell.
      Then the report says 0 signalled and 0 killed
      And no grace period was waited out

    Scenario: Stopping a run with nothing registered is not an error
      When "r1" is stopped
      Then the report says 0 signalled and 0 killed

  Rule: stop all means all

    Scenario: Every run's processes are stopped
      Given a process registered for run "r1"
      And a process registered for run "r2"
      And a second process registered for run "r2"
      When everything is stopped
      Then the report says 3 signalled and 3 killed

    Scenario: Stopping everything when nothing runs is not an error
      When everything is stopped
      Then the report says 0 signalled and 0 killed

  Rule: a spawn that never started registers nothing

    Scenario: A child with no pid cannot be held
      Given a child process that failed to start
      Then it cannot be registered
      # An entry that can never be cleared is worse than no entry: pids are
      # reused, and this class signals pids.

  Rule: the group, not the process — proved on a real one

    Everything above drives fakes. This spawns `bash -c 'sleep 30 & wait'`,
    whose actual work is a grandchild — which is the shape of every Factory
    step, because a step is `bash -c '<the project's command>'`.

    Signalling one pid killed the shell and left the work running. That is what
    `detached: true` and a negative pid fix, and it is the whole reason this
    module exists.

    Scenario: Killing the group takes the grandchild with it
      Given a real detached shell whose work is a grandchild
      When its group is stopped
      Then the grandchild is gone

    Scenario: Killing only the process would leave the grandchild
      Given a real detached shell whose work is a grandchild
      When only the shell itself is signalled
      # Stated as the thing that used to happen, so the fix has a failure to be
      # the fix *of*. Left running and then cleaned up.
      Then the grandchild is still there
