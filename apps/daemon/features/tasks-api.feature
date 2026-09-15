Feature: Tasks, runs and live updates over HTTP
  The board is a client of this API and nothing more. Everything it shows comes
  from here, including which buttons to draw: a task is served with the list of
  actions currently available to it, because a client that works that out for
  itself will disagree with the state machine sooner or later, and the
  disagreement looks like a button that does nothing.

  The daemon is also where work actually happens. It opens the database,
  corrects whatever a crash left behind, and runs the scheduler — so queueing a
  task through this API is enough to make it run.

  Background:
    Given a running daemon with a project scope
    And a workflow "hello" that prints "hello"

  Scenario: Creating a task
    When I create the task "Add due dates"
    Then the response is 201
    And the task is "draft"
    And the available actions do not include "start"

  Scenario: A task with a workflow can be queued
    When I create the task "Add due dates" with the workflow "hello"
    Then the available actions include "queue"

  Scenario: Listing tasks
    Given the task "Add due dates" exists
    And the task "Old news" exists and is archived
    When I list the tasks
    Then 1 task is listed
    When I list the tasks including archived ones
    Then 2 tasks are listed

  Scenario: Reading one task
    Given the task "Add due dates" exists
    When I read the task
    Then the response is 200
    And the task comes with its actions, history and runs

  Scenario: A task that does not exist
    When I read the task "nope"
    Then the response is 404

  Scenario: Assigning workflows
    Given the task "Add due dates" exists
    When I assign the workflow "hello"
    Then the task is on "hello"
    And the available actions include "queue"

  Scenario: An action the task cannot do right now
    Given the task "Add due dates" exists
    When I ask to approve the task
    Then the response is 409
    And the response says what the task can do instead

  Scenario: An action that belongs to the engine
    Given the task "Add due dates" exists with the workflow "hello"
    When I ask to start the task
    Then the response is 409

  Scenario: An action that does not exist
    Given the task "Add due dates" exists
    When I ask to teleport the task
    Then the response is 400

  Scenario: Deleting a task
    Given the task "Add due dates" exists
    When I delete the task
    Then the response is 204
    And the task is gone

  Scenario: Queueing a task runs it
    Given the task "Add due dates" exists with the workflow "hello"
    When I queue the task
    And the work finishes
    Then the task is "done"
    And the task has a run
    And the run is "completed"

  Scenario: A run's steps and output are readable
    Given the task "Add due dates" exists with the workflow "hello"
    And the task has been queued and has finished
    When I read the run
    Then the run has 1 step
    And the step's output contains "hello"
    And nothing was dropped from the output

  Scenario: Adding a project
    When I add the project "work" at the scope's directory
    Then the response is 201
    And the project is listed

  Scenario: A project at a path that does not exist is refused
    When I add the project "ghost" at a path that does not exist
    Then the response is 400
    And the response explains why

  Scenario: A task can be given a project
    Given the project "work" exists
    When I create the task "Add due dates" in that project
    Then the response is 201
    And the task belongs to the project

  Scenario: A task in a project runs in that project's directory
    Given a project in a directory the daemon was not started in
    And a workflow "where" that prints the directory it runs in
    And the task "Add due dates" exists in that project with the workflow "where"
    When I queue the task
    And the work finishes
    Then the output names the project's directory

  Scenario: A task gets its own worktree, and the work happens there
    Given a project that is a real git repository
    And the task "Add due dates" in it, on "worktree-create" and then "where"
    When I queue the task
    And the work finishes
    Then the task has the flag "hasWorktree"
    And a worktree exists for the task
    And the second workflow ran inside the worktree

  Scenario: Setup says what is still missing
    When I ask what setup is left
    Then the response is 200
    And adding a repository is one of the steps
    And it is marked essential

  Scenario: Adding a repository finishes that step
    Given the project "work" exists
    When I ask what setup is left
    Then adding a repository is done

  Scenario: A project can be added to work in its own checkout
    When I add the project "in-place" working in its own checkout
    Then the response is 201
    And the project does not use worktrees

  Scenario: Worktrees can be turned off on a project that already exists
    Given a project that is a real git repository
    When I turn its worktrees off
    Then the response is 200
    And the project does not use worktrees

  Scenario: Turning worktrees on where there is no repository is refused
    Given a project at a directory that is not a repository
    When I turn its worktrees on
    Then the response is 400
    And the response says it is not a git repository

  Scenario: Changing a project that does not exist is not found
    When I turn worktrees off on a project that does not exist
    Then the response is 404

  Scenario: A change that says nothing is refused
    Given the project "work" exists
    When I send a change with no setting in it
    Then the response is 400

  Scenario: A task in a project that works in its own checkout runs there
    Given a project that is a real git repository, working in its own checkout
    And a worktree directory left over from before
    And the task "Add due dates" exists in that project with the workflow "where"
    When I queue the task
    And the work finishes
    Then the output names the repository itself, not the leftover worktree

  Scenario: Health reports what the boot recovered
    When I ask for health
    Then the response is 200
    And health says how many runs were recovered

  Scenario: The live stream carries what happens
    Given I am listening to the live stream
    When I create the task "Add due dates"
    Then the stream delivers "task.created"

  # The board holds this stream open for as long as it is on screen, so this is
  # the ordinary case rather than an edge one: quit the app, and the engine has
  # a live stream when it is asked to stop. `close()` waits for in-flight
  # requests and a hijacked stream is never not in flight — so the port was
  # released while the process stayed alive for ever, which reads as "Factory is
  # down" with a running daemon in the process table.
  #
  # Note the scenario closes the server *with the stream still open*. The suite's
  # own teardown closes the stream first, which is why the scenario above never
  # caught this.
  Scenario: Stopping does not wait for a live stream for ever
    Given I am listening to the live stream
    When the server is asked to stop
    Then it stops rather than hanging on the open stream

  Rule: A project's definitions are its own

    A workflow committed to a repository is part of that repository. Factory
    resolves definitions through a chain of scopes, and until now the daemon
    used one chain for everything — the one belonging to whatever directory it
    was started in. So a project's own workflows were invisible to its own
    tasks unless you launched the daemon inside it.

    Scenario: A project's own workflows are listed for that project
      Given a project with a workflow of its own
      When I list the workflows for that project
      Then "deploy" is listed
      And it says it came from the project

    Scenario: A project sees the installation's workflows too
      Given a workflow "greeting" everyone shares
      And a project with a workflow of its own
      When I list the workflows for that project
      Then "greeting" is listed
      And it says it came from the user

    Scenario: A project's own workflow belongs to nobody else
      Given a project with a workflow of its own
      When I list the workflows
      Then "deploy" is not listed

    Scenario: Asking about a project that does not exist
      When I list the workflows for a project that does not exist
      Then the response is 404

    Scenario: A task runs a workflow its own project defines
      Given a project with a workflow of its own
      And the task "Ship it" exists in that project with the workflow "deploy"
      When I queue it
      And the work finishes
      Then the output says the project's own workflow ran

  Rule: A plan can only be changed while the task is not carrying it out

    Scenario: Workflows cannot be changed while the task is running
      Given a workflow "waiting" that takes its time
      And the task "Add due dates" exists with the workflow "waiting"
      When I queue it
      And it is running
      And I assign the workflow "hello"
      Then the response is 409
      And it says the task is running

    Scenario: An edit keeps what has run and adds what is new
      Given the task "Add due dates" exists with the workflow "hello"
      And the work finishes
      When I assign a different list of workflows
      Then the workflow that ran is still marked as having run
      And the one just added is ticked

    Scenario: A workflow that has already run cannot be taken off the list
      Given the task "Add due dates" exists with the workflow "hello"
      And the work finishes
      When I take every workflow off the list
      Then the response is 409
      And the refusal names "hello"

  Rule: A task can be renamed, and agents are definitions like any other

    Scenario: A task can be renamed
      Given the task "Add due dates" exists
      When I rename it to "Add due dates and times"
      Then the response is 200
      And the task is called "Add due dates and times"

    Scenario: Renaming does not move where its work lives
      Given the task "Add due dates" exists
      When I rename it to "Something else entirely"
      Then its directory is unchanged

    Scenario: A task cannot be renamed while it is running
      Given a workflow "waiting" that takes its time
      And the task "Add due dates" exists with the workflow "waiting"
      When I queue it
      And it is running
      And I rename it to "Too late"
      Then the response is 409

    Scenario: A change that says nothing at all is refused
      Given the task "Add due dates" exists
      When I send a change with neither a name nor workflows
      Then the response is 400

    Scenario: A task can be described
      Given the task "Add due dates" exists
      When I describe it as "Every todo gets an optional due date."
      Then the response is 200
      And the task's description is "Every todo gets an optional due date."

    Scenario: A description can be cleared, unlike a name
      Given the task "Add due dates" exists
      When I describe it as ""
      Then the response is 200
      And the task's description is empty

    Scenario: A description that is not text is refused
      Given the task "Add due dates" exists
      When I describe it as the number 7
      Then the response is 400

    Scenario: The description a task was created with is kept
      Given the task "Add due dates" is created with a description
      Then the task's description is "Every todo gets an optional due date."

    Scenario: A step can write the description into its prompt
      Given a project with a workflow whose step echoes "{{ task.description }}"
      And the task "Ship it" exists in that project with that workflow and a description
      When I queue it
      And the work finishes
      Then the output says what the task was for

    Scenario: Agents are listed, written and read back
      When I write the agent "developer"
      Then the response is 201
      When I list the agents
      Then "developer" is listed

    Scenario: A step can name an agent and the plan uses its model
      Given a project with an agent "developer" and a workflow that uses it
      And the task "Ship it" exists in that project with the workflow "greeting"
      When I queue it
      And the work finishes
      Then the output says which agent ran

  Rule: Turning a project setting on gives the project its own copies

    Scenario: Turning environments on scaffolds the environment workflows
      Given the project "work" exists
      When I turn environments on
      Then the response is 200
      And the project uses environments
      And "environment-create" was written into the project

    Scenario: Those copies resolve from the project afterwards
      Given the project "work" exists
      When I turn environments on
      And I list the workflows for that project
      Then "environment-create" came from the project

    Scenario: Turning a setting off writes nothing and removes nothing
      Given the project "work" exists
      And environments are on
      When I turn environments off
      Then the project does not use environments
      And nothing was written

  Rule: A workflow gated on a facility the project has switched off is not offered

    Nothing provides `hasWorktree` for a project that does not use worktrees, so
    a workflow dealing in that flag would sit in the queue for ever or build
    something the project has said it does not want. It is marked rather than
    dropped: the file is still the project's to open, edit and delete, and only
    the list of what to run next has no business offering it.

    Matching is on the flag, never the name — a renamed copy of
    `worktree-create` still declares `provides: [hasWorktree]`, and that is the
    property this codebase protects everywhere else.

    Scenario: Worktree workflows are unavailable where worktrees are off
      Given the project "work" exists
      And worktrees are off
      When I list the workflows for that project
      Then "worktree-create" is unavailable because of "worktrees"
      And "worktree-delete" is unavailable because of "worktrees"

    Scenario: A project that uses worktrees is offered them
      Given the project "work" exists
      When I list the workflows for that project
      Then "worktree-create" is available

    Scenario: A workflow that only requires the flag is unavailable too
      Given the project "work" exists
      And environments are on
      When I turn environments off
      And I list the workflows for that project
      Then "environment-update" is unavailable because of "environments"

    Scenario: A renamed copy is judged by its flags, not its name
      Given the project "work" exists
      And the project has its own workflow "spin-up" that provides "hasEnvironment"
      When I list the workflows for that project
      Then "spin-up" is unavailable because of "environments"

    Scenario: A workflow that deals in neither is always offered
      Given the project "work" exists
      When I list the workflows for that project
      Then "greeting" is available

  Rule: progress counts phases across the whole plan

    It used to count steps of whichever run was newest. That was right when a
    task had one workflow and has been wrong ever since a task became a list of
    them: each workflow is a fresh run, so the number never climbed past that
    one run's own steps — a five-stage pipeline sat at "0/1" throughout.

    Phases, because that is the unit the interface reference counts in
    both show, and the only one that moves smoothly.

    Scenario: A task that has run nothing reports none of its phases
      Given the task "Add due dates" exists with the workflow "hello"
      When I ask for the task list
      Then "Add due dates" reports 0 of 1 phases

    Scenario: A finished workflow reports its phases
      Given the task "Add due dates" exists with the workflow "hello"
      And the work finishes
      When I ask for the task list
      Then "Add due dates" reports 1 of 1 phases

    Scenario: A workflow that ran twice counts once
      Given the task "Add due dates" exists with the workflow "hello"
      And the work finishes
      And it is ticked back on and finishes again
      When I ask for the task list
      Then "Add due dates" reports 1 of 1 phases

    Scenario: Two workflows are two sets of phases
      Given the task "Add due dates" exists with the workflows "hello, hello"
      And the work finishes
      When I ask for the task list
      Then "Add due dates" reports 2 of 2 phases

    Scenario: A workflow that cannot be planned still leaves the rest counted
      Given the task "Add due dates" exists with the workflow "hello" then "nowhere"
      And the work stops
      When I ask for the task list
      Then "Add due dates" reports 1 of 1 phases

    Scenario: The task's own page reports it too
      Given the task "Add due dates" exists with the workflow "hello"
      And the work finishes
      When I ask for the task
      Then it reports 1 of 1 phases

  Rule: a task's artifacts are listed, and one can be read

    Artifacts are read out of the evidence rows rather than off disk. That is
    what evidence is copied into the database for — and it means these routes
    take a task and a name rather than a path, so there is nothing to traverse.

    Scenario: The task lists what it produced, without the content
      Given the task "Check it" exists with a workflow that writes a report
      And the work finishes
      When I ask for the task
      Then "report" is one of its artifacts
      And the listing carries no content

    Scenario: One artifact comes back with its content
      Given the task "Check it" exists with a workflow that writes a report
      And the work finishes
      When I ask for the artifact "report"
      Then the response is 200
      And it carries the text that was written

    Scenario: A name it never produced is not found
      Given the task "Check it" exists with a workflow that writes a report
      And the work finishes
      When I ask for the artifact "nowhere"
      Then the response is 404

    Scenario: An artifact on a task that does not exist is not found
      When I ask for an artifact of a task that does not exist
      Then the response is 404

  Rule: a task says where its work is

    The path was already computed on every run — it is what the engine spawns
    steps in — and it never left the daemon. The ingredients were served
    separately, on two different routes, and no client joined them, so the first
    question anybody asks about a running task had no answer on screen.

    Scenario: The task detail carries the directory its steps run in
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task
      Then its workspace is the project's directory
      And the workspace is not a worktree
      And the workspace names the project "work"

    Scenario: A worktree on the disk is where the work is
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And a worktree for it exists on the disk
      When I ask for the task
      Then its workspace is that worktree
      And the workspace is a worktree

    Scenario: A task belonging to no project has no workspace
      Given the task "Add due dates" exists with the workflow "hello"
      When I ask for the task
      # The daemon's own directory is where such a task would run, but offering
      # to open it would be offering a directory nobody chose.
      Then it has no workspace

    Scenario: The task list does not carry it
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task list
      Then no listed task carries a workspace

  Rule: each tool answers its own question, and says why it cannot

    The buttons on a task come from plugins now. Where the work is happening is
    worth asking of a task that has never run; carrying on the conversation the
    agent was having only means anything once there has been one. A single
    control that silently became the second as soon as a session existed would
    have taken the first away.

    Scenario: The tools come from plugins, in their own order
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task
      Then its tools are "open-terminal, open-session, diffity"
      And each tool says which plugin provided it

    Scenario: The tools are beside the actions, not inside the workspace
      Given the task "Add due dates" exists with the workflow "hello"
      When I ask for the task
      # A task with no project has no workspace at all, and a tool that needs
      # no directory would be unreachable nested inside one.
      Then it has no workspace
      And it still has tools

    Scenario: A terminal tool only changes directory
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task
      Then "open-terminal" would run "cd" to the workspace

    Scenario: A path with a space in it is quoted, not interpolated
      Given the project "my work" exists at a directory with a space in its name
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task
      Then "open-terminal" quotes the directory

    Scenario: The session tool is the provider's own flag and the task's id
      Given the project "work" exists at the scope's directory
      And the task "Check it" exists in it, with the session "s-99" on "claude"
      When I ask for the task
      Then "open-session" would run "claude --resume s-99"
      And "open-session" is available

    Scenario: A task no agent has run for is offered the session tool anyway
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task
      # Disabled with its reason, not hidden: a control that appears once a
      # task has run is one nobody knew to look for.
      Then "open-session" is offered
      And "open-session" is unavailable
      And its reason mentions a session

    Scenario: A session whose provider is no longer installed names it
      Given the project "work" exists at the scope's directory
      And the task "Check it" exists in it, with the session "s-99" on "gone"
      When I ask for the task
      Then "open-session" is unavailable
      And its reason mentions "gone"

    Scenario: Whether a tool can be performed is served, not guessed
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I ask for the task
      Then "open-terminal" is not runnable
      # The daemon starts a detached tool itself, so nothing need be installed.
      And "diffity" is runnable

  Rule: the route runs the tool that was named

    `{ session: true }` is gone: even the choice between two commands is the
    server's now. A client sends a tool id, and the directory and the argv come
    from the tool, which got them from the task — so there is still nothing
    anybody sends that reaches a process.

    Scenario: A terminal tool is handed to whatever can open one
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And something that can open a terminal is installed
      When I run the tool "open-terminal"
      Then the response is 200
      And it was asked to open the workspace
      And it was asked to run nothing

    Scenario: The session tool resumes by id
      Given the project "work" exists at the scope's directory
      And the task "Check it" exists in it, with the session "s-99" on "claude"
      And something that can open a terminal is installed
      When I run the tool "open-session"
      Then it was asked to run "claude --resume s-99"

    Scenario: A detached tool is started by the daemon itself
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And "diffity" is installed
      When I run the tool "diffity"
      Then the response is 200
      # No terminal capability anywhere, which is the point: this is the half
      # that works in Community.
      And it reports a detached run
      And the detached launcher was asked to run diffity

    Scenario: The client never says which directory
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And something that can open a terminal is installed
      # Nothing the client sends reaches a process. The claim is stronger than
      # it was: a tool id is not even a command.
      When I run the tool "open-terminal" while asking for somewhere else
      Then it was asked to open the workspace

    Scenario: A tool nobody registered is not found
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I run the tool "nonsense"
      Then the response is 404

    Scenario: A tool that cannot be used here is refused with its own reason
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And something that can open a terminal is installed
      When I run the tool "open-session"
      Then the response is 409
      And the error mentions a session
      And nothing was opened

    Scenario: A tool from a plugin switched off since the page loaded is refused
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And something that can open a terminal is installed
      And the plugin providing "open-terminal" is switched off
      When I run the tool "open-terminal"
      Then the response is 404
      And nothing was opened

    Scenario: A tool for a task that does not exist is not found
      When I run a tool for a task that does not exist
      Then the response is 404

  Rule: performing a terminal tool is a capability, and its absence is an answer

    Community has no platform detection in it anywhere, and starting a terminal
    application is the most platform-specific act there is. So the route asks
    the host and reports 501 when nothing answers — with the command in the
    body, which is what the board offers to copy.

    Scenario: With nothing installed the route hands back the command instead
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      When I run the tool "open-terminal"
      Then the response is 501
      And the response carries the command to run

    Scenario: A terminal that will not open says why
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And something that refuses to open a terminal is installed
      When I run the tool "open-terminal"
      Then the response is 500
      And the response explains why

    Scenario: A detached tool that will not start says why
      Given the project "work" exists at the scope's directory
      And the task "Add due dates" exists in it with the workflow "hello"
      And "diffity" is installed
      And starting something detached will fail
      When I run the tool "diffity"
      Then the response is 500
      And the response explains why
