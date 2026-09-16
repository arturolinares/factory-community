Feature: The task board
  The board is where the work is watched. It shows what is queued, what is
  running, what is waiting for a person and what went wrong, and it keeps up on
  its own — a run started by the scheduler changes this page with nobody
  touching it.

  Its buttons come from the daemon. Each task is served with the actions it can
  take right now, and the board draws those and nothing else, so a button that
  is on screen is one the state machine will accept.

  Background:
    Given a project scope and a user scope
    And the project defines the workflow "hello" that prints "hello"

  Scenario: An empty board says what a task is
    When I open the tasks page
    Then the board says there is nothing yet

  Scenario: Creating a task
    When I open the tasks page
    And I create the task "Add due dates" on "hello"
    Then the task page for "Add due dates" opens
    When I go back to the board
    Then "Add due dates" is on the board
    And "Add due dates" is "draft"
    And "Add due dates" offers "Queue"

  Scenario: A task with no workflow cannot be queued
    When I open the tasks page
    And I create the task "Just an idea" with no workflow
    And I go back to the board
    Then "Just an idea" does not offer "Queue"

  Scenario: The summary counts what is there
    Given the task "Add due dates" exists on "hello"
    When I open the tasks page
    Then the board counts 1 task in total

  Scenario: Filtering by status
    Given the task "Add due dates" exists on "hello"
    When I open the tasks page
    And I filter by the status "Running"
    Then the board says there is nothing yet
    When I filter by the status "All statuses"
    Then "Add due dates" is on the board

  Scenario: The board view groups by state
    Given the task "Add due dates" exists on "hello"
    When I open the tasks page
    And I switch to the board view
    Then "Add due dates" is in the "draft" column

  Scenario: Queueing a task runs it, and the board follows
    Given the task "Add due dates" exists on "hello"
    When I open the tasks page
    And I queue "Add due dates"
    Then "Add due dates" becomes "done" without me reloading

  Scenario: A task's run, steps and output
    Given the task "Add due dates" exists on "hello"
    When I open the tasks page
    And I queue "Add due dates"
    And "Add due dates" becomes "done" without me reloading
    And I open "Add due dates"
    Then the run for "hello" is listed
    And the step "echo hello" is listed
    And opening the step shows "hello"

  Scenario: Adding a project
    When I open the projects page
    And I add the project "work" at the project directory
    Then "work" is listed as a project

  Scenario: A project that is not there is refused with a reason
    When I open the projects page
    And I add the project "ghost" at a path that does not exist
    Then the page explains that there is nothing at that path

  Scenario: A task can be created in a project
    Given the project "work" is registered
    When I open the tasks page
    And I create the task "Add due dates" in "work" on "hello"
    And I go back to the board
    Then "Add due dates" is on the board
    And "Add due dates" shows the project "work"

  Scenario: Evidence is on the page the approval is decided on
    Given the project defines the workflow "review" that writes a report and asks for approval
    And the task "Check it" exists on "review"
    When I open the tasks page
    And I queue "Check it"
    And "Check it" becomes "awaiting_approval" without me reloading
    And I open "Check it"
    Then the evidence from "report" is shown
    And the evidence reads "looks good"

  Scenario: Approving from the task page finishes the work
    Given the project defines the workflow "review" that writes a report and asks for approval
    And the task "Check it" exists on "review"
    When I open the tasks page
    And I queue "Check it"
    And "Check it" becomes "awaiting_approval" without me reloading
    And I open "Check it"
    And I approve it
    Then the task finishes

  Scenario: The setup page says what is still missing
    When I open the setup page
    Then "Add a repository" is a setup step
    And it is marked essential
    And the page says Factory cannot run work yet

  Scenario: A setup step offers the command that fixes it
    When I open the setup page
    Then a setup step offers a command to copy

  Scenario: A project can be added to work in its own checkout
    When I open the projects page
    And I add the project "in-place" at the project directory, without worktrees
    Then "in-place" is listed as a project
    And "in-place" says it works in the repository, one task at a time

  Scenario: Worktrees can be turned off from the projects page
    Given the project "work" is registered
    When I open the projects page
    And I switch "work" to working in the repository
    Then "work" says it works in the repository, one task at a time

  Scenario: The daemon not running is explained
    Given the daemon is not running
    When I open the tasks page
    Then the page says it cannot reach the daemon

  Rule: The rail says which project the board is about

    Factory runs work in several repositories at once, and a board that mixes
    them is a board you have to read carefully. The rail picks one; everything
    that is genuinely about that project then narrows to it — including the
    definitions, which are files in the project and not rows to be filtered.

    Scenario: Every project has a square, and All is chosen to begin with
      Given the project "work" is registered
      When I open the tasks page
      Then the rail offers "work"
      And the board is showing every project

    Scenario: Choosing a project shows only its tasks
      Given the project defines the workflow "hello" that prints "hello"
      And the project "work" is registered
      And the task "In the repo" exists in "work" on "hello"
      And the task "Loose" exists on "hello"
      When I open the tasks page
      And I choose the project "work"
      Then "In the repo" is on the board
      And "Loose" is not on the board
      And the board counts 1 task in total

    Scenario: All brings everything back
      Given the project defines the workflow "hello" that prints "hello"
      And the project "work" is registered
      And the task "In the repo" exists in "work" on "hello"
      And the task "Loose" exists on "hello"
      When I open the tasks page
      And I choose the project "work"
      And I choose every project
      Then "Loose" is on the board

    Scenario: The choice is still there after a reload
      Given the project defines the workflow "hello" that prints "hello"
      And the project "work" is registered
      And the task "In the repo" exists in "work" on "hello"
      And the task "Loose" exists on "hello"
      When I open the tasks page
      And I choose the project "work"
      And I reload the page
      Then "Loose" is not on the board

    Scenario: A project's own workflows are what it can use
      Given a second project "other" that defines the workflow "deploy"
      When I open the workflows page
      And I choose the project "other"
      Then the workflow "deploy" is listed
      And "deploy" shows the project scope

    Scenario: Another project's workflows are not on offer
      Given the project defines the workflow "development"
      And the project "work" is registered
      And a second project "other" that defines the workflow "deploy"
      When I open the workflows page
      And I choose the project "work"
      Then the workflow "development" is listed
      And the workflow "deploy" is not listed

    Scenario: A project's square looks the same after a reload
      Given the project "work" is registered
      When I open the tasks page
      And I remember the colour of "work"
      And I reload the page
      Then "work" is the same colour

  Rule: A task's workflows are an ordered list, editable until it starts

    The order is what decides what runs when, so it is shown as an order:
    numbered, with the controls to change it. The old form had toggle buttons
    and no visible order at all.

    Scenario: New task has a page of its own
      When I open the tasks page
      And I start a new task
      Then the new task page is open

    Scenario: Workflows keep the order they were added in
      Given the project defines the workflow "hello" that prints "hello"
      And the project defines the workflow "development"
      When I start a new task from the board
      And I add the workflow "development"
      And I add the workflow "hello"
      Then the workflows are "development, hello"

    Scenario: The order can be changed before the task is made
      Given the project defines the workflow "hello" that prints "hello"
      And the project defines the workflow "development"
      When I start a new task from the board
      And I add the workflow "development"
      And I add the workflow "hello"
      And I move the second workflow up
      Then the workflows are "hello, development"

    Scenario: A workflow can be taken back out
      Given the project defines the workflow "hello" that prints "hello"
      And the project defines the workflow "development"
      When I start a new task from the board
      And I add the workflow "development"
      And I add the workflow "hello"
      And I remove the first workflow
      Then the workflows are "hello"

    Scenario: Two clicks in the same instant both count
      Given the project defines the workflow "hello" that prints "hello"
      And the project defines the workflow "development"
      When I start a new task from the board
      And I add "development" and "hello" in the same instant
      Then the workflows are "development, hello"

    Scenario: The same workflow can be run more than once
      Given the project defines the workflow "development"
      When I start a new task from the board
      And I add the workflow "development"
      And I add the workflow "development"
      Then the workflows are "development, development"

    Scenario: A task that has not started can be replanned from its page
      Given the project defines the workflow "hello" that prints "hello"
      And the project defines the workflow "development"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I open "Add due dates"
      And I add the workflow "development"
      And I save the workflows
      Then the workflows are "hello, development"

    Scenario: A task waiting for a person cannot be replanned
      Given the project defines the workflow "review" that writes a report and asks for approval
      And the task "Check it" exists on "review"
      When I open the tasks page
      And I queue "Check it"
      And "Check it" becomes "awaiting_approval" without me reloading
      And I open "Check it"
      Then the workflows cannot be changed

  Rule: The board says what each page is about

    Scenario: The menu is grouped into sections
      When I open the tasks page
      Then the menu has a "library" section
      And the menu has a "system" section
      And "Agents" is in the menu
      And "Environments" is in the menu

  Rule: A task can be renamed from its own page

    Scenario: Renaming a task
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I open "Add due dates"
      And I rename it to "Add due dates and times"
      Then the task is called "Add due dates and times"

    Scenario: A task waiting for a person cannot be renamed
      Given the project defines the workflow "review" that writes a report and asks for approval
      And the task "Check it" exists on "review"
      When I open the tasks page
      And I queue "Check it"
      And "Check it" becomes "awaiting_approval" without me reloading
      And I open "Check it"
      Then it cannot be renamed

  Rule: Environments are tracked by the flag the workflows earn

    Scenario: A project that does not use environments has nothing to show
      Given the project "work" is registered
      When I open the environments page
      Then the environments page is empty

    Scenario: Turning environments on writes the workflows into the project
      Given the project "work" is registered
      When I open the projects page
      And I turn environments on for "work"
      Then "work" says it gives each task an environment
      And the page lists what it copied in

    Scenario: A task holding an environment is listed under its project
      Given the project "work" is registered, using environments
      And the task "Seeded" in "work" is holding an environment
      # The flag is earned by a workflow that ran, not set by the test.
      When I open the environments page
      Then "Seeded" is listed as holding an environment

  Rule: A step chooses its agent from what exists

    Scenario: The provider field offers what is installed
      When I open the new phase page
      And I add a step
      And I set the step kind to "agent"
      Then the step's "provider" field offers "claude"

    Scenario: The agent field offers the agents this project can see
      Given the project defines the agent "developer"
      When I open the new phase page
      And I add a step
      And I set the step kind to "agent"
      Then the step's "agent" field offers "developer"

    Scenario: Naming an agent leaves only the prompt to fill in
      Given the project defines the agent "developer"
      When I open the new phase page
      And I add a step
      And I set the step kind to "agent"
      And I name the agent "developer" on the step
      Then the step still asks for a "prompt"
      And the step no longer asks for a "provider"
      And the step no longer asks for a "model"
      And the step says "developer" supplies them

    Scenario: One setting can still be overridden on the step
      Given the project defines the agent "developer"
      When I open the new phase page
      And I add a step
      And I set the step kind to "agent"
      And I name the agent "developer" on the step
      And I choose to override one
      Then the step asks for a "model" again

    Scenario: A setting already on the step is never hidden
      Given the project defines the agent "developer"
      When I open the new phase page
      And I add a step
      And I set the step kind to "agent"
      And I set the step's "effort" to "high"
      And I name the agent "developer" on the step
      Then the step still asks for a "effort"

  Rule: A task carries what it is for, and it is editable where it is read

    Scenario: Describing a task from its page
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I open "Add due dates"
      And I describe it as "Every todo gets an optional due date."
      Then the task's description is "Every todo gets an optional due date."

    Scenario: A task with no description invites one
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I open "Add due dates"
      Then the description asks what the task is for

    Scenario: A task waiting for a person cannot be described
      Given the project defines the workflow "review" that writes a report and asks for approval
      And the task "Check it" exists on "review"
      When I open the tasks page
      And I queue "Check it"
      And "Check it" becomes "awaiting_approval" without me reloading
      And I open "Check it"
      Then it cannot be described

  Rule: A phase's steps come with the vocabulary they can be written in

    Nothing in the builder used to say that `{{ task.directory }}` existed. The
    only way to find out was to read the daemon, so the dictionary is served
    from the same list the resolver uses rather than typed into the page.

    Scenario: The dictionary is collapsed until it is asked for
      When I open the new phase page
      Then the token dictionary is offered
      And the token list is not showing

    Scenario: Opening it lists the tokens a step may use
      When I open the new phase page
      And I open the token dictionary
      Then "{{ task.description }}" is listed
      And "{{ task.artifacts }}" is listed
      And "{{ project.path }}" is listed

    Scenario: A variable the phase declares is listed too
      When I open the new phase page
      And I declare the variable "region" as "eu-west-1"
      And I open the token dictionary
      Then "{{ phase.region }}" is listed

    Scenario: A phase that declares nothing says so rather than showing a gap
      When I open the new phase page
      And I open the token dictionary
      Then the phase namespace says it declares none yet

  Rule: A task is only offered workflows its project can actually run

    Scenario: A project that does not use worktrees is not offered them
      Given the project "plain" is registered, without worktrees
      When I start a new task from the board
      And I pick the project "plain" for the task
      Then "worktree-create" is not on offer
      And "worktree-delete" is not on offer

    Scenario: A project that uses worktrees still is
      Given the project "isolated" is registered, using worktrees
      When I start a new task from the board
      And I pick the project "isolated" for the task
      Then "worktree-create" is on offer

  Rule: picking a workflow brings in what it needs

    `verify` reads artifacts that three earlier workflows write. Picking it on
    its own used to make a task whose prompt pointed at files nothing produced.

    Scenario: Picking the last of a chain brings in the rest
      Given the project defines the chain "first" then "second" then "third"
      When I start a new task from the board
      And I pick the project "chained" for the task
      And I add the workflow "third"
      Then the workflows are "first, second, third"
      And it says what was brought in

    Scenario: Only the missing ones are added
      Given the project defines the chain "first" then "second" then "third"
      When I start a new task from the board
      And I pick the project "chained" for the task
      And I add the workflow "second"
      And I add the workflow "third"
      Then the workflows are "first, second, third"

    Scenario: A workflow that needs nothing is added on its own
      Given the project defines the chain "first" then "second" then "third"
      When I start a new task from the board
      And I pick the project "chained" for the task
      And I add the workflow "first"
      Then the workflows are "first"

  Rule: a workflow unticks itself when it is done, and you can tick it back

    Scenario: A workflow that has run is shown as having run
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I queue "Add due dates"
      And "Add due dates" becomes "done" without me reloading
      And I open "Add due dates"
      Then "hello" is marked as having run
      And "hello" is unticked

    Scenario: It cannot be taken off the list
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I queue "Add due dates"
      And "Add due dates" becomes "done" without me reloading
      And I open "Add due dates"
      Then "hello" has no remove button

    Scenario: A finished task offers to tick them all again
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I queue "Add due dates"
      And "Add due dates" becomes "done" without me reloading
      And I open "Add due dates"
      Then it offers to tick them all again

  Rule: an artifact is a document, and the task page is where you find it

    Five documents of Markdown were readable only as monospace source inside a
    run's evidence panel, and only if you opened the right run.

    Background:
      Given the project defines the workflow "review" that writes a report and asks for approval
      And the report it writes is a Markdown document
      And the task "Check it" exists on "review"
      When I open the tasks page
      And I queue "Check it"
      And I open "Check it"
      And I approve it
      And the task finishes

    Scenario: The task lists its artifacts
      Then "report" is listed as an artifact

    Scenario: They sit between the plan and the runs
      # The order the page reads in: what this task will do, what it produced,
      # then the machinery that produced it.
      Then the artifacts come after the workflows and before the runs

    Scenario: An artifact opens on a page of its own
      When I open the artifact "report"
      Then the artifact page shows its path

    Scenario: It is rendered, not printed
      When I open the artifact "report"
      Then "Findings" is a heading
      And the source markup is not on screen

    Scenario: The evidence header links to the readable version
      Then the path in the evidence header opens "report"

  Rule: an artifact is text an agent wrote, so nothing in it runs

    The prototype this follows renders the same content through `v-html` with no
    sanitiser. A model that emits an onerror attribute — quoting a bug report,
    say — would then be running script in the board.

    Background:
      Given the project defines the workflow "review" that writes a report and asks for approval
      And the report it writes tries to run something
      And the task "Check it" exists on "review"
      When I open the tasks page
      And I queue "Check it"
      And I open "Check it"
      And I approve it
      And the task finishes

    Scenario: A script attribute is stripped
      When I open the artifact "report"
      Then nothing on the page can run
      And the text around it is still shown

  Rule: a task says where its work is, and offers a way in

    The directory a task's steps run in was computed on every run and never left
    the daemon, so the first question anybody asks about a task that needs
    looking at by hand had no answer on screen.

    Nothing in Community can open a terminal — starting one is thoroughly
    platform-specific, and the open core has no platform detection in it
    anywhere. So this is the degrading half: the same command, to copy.

    Background:
      Given the project defines the workflow "hello" that prints "hello"
      And the project "work" is registered
      And the task "Add due dates" exists on "hello" in "work"
      When I open the tasks page
      And I open "Add due dates"

    Scenario: The row names the project and the directory
      Then the workspace row names the project "work"
      And the workspace row shows the project's directory

    Scenario: The path can be copied
      When I copy the workspace path
      Then the clipboard holds the project's directory
      And the page says it copied it

    Scenario: With nothing able to open a terminal, the command is offered
      Then the button offers to copy the command
      When I ask for a terminal
      Then the clipboard holds a command that changes directory there

    Scenario: The session control is there from the start, and says why it is not ready
      # Disabled rather than hidden: a control that only appears once a task
      # has run is one nobody knew to look for. Its reason now comes from the
      # plugin that owns it rather than being written into the page.
      Then the session control is offered but not ready
      And it says a session is recorded the first time an agent runs

    Scenario: Every button on the row comes from a plugin
      Then the row offers "Open terminal", "Open session" and "Diffity"


  Rule: a session an agent really had is offered back

    Factory chooses the session id, which is the only way to offer the exact
    conversation again: Claude's interactive `--continue` refuses the sessions
    `claude -p` creates, and "the most recent one in this directory" is the
    wrong one as soon as two tasks share a directory.

    The control is there either way and only becomes usable once an agent has
    run, because until then there is no conversation — and the id is recorded
    when the process starts, not when the run is planned.

    Background:
      Given the project defines the workflow "review" whose agent carries a session
      And the project "work" is registered
      And the task "Check it" exists on "review" in "work"
      When I open the tasks page

    Scenario: Before anything runs the session control is not ready
      When I open "Check it"
      Then the session control is offered but not ready

    Scenario: After the agent has run the session can be opened
      When I queue "Check it"
      And the task finishes
      And I open "Check it"
      Then the session control is ready
      And the session command resumes by id

    Scenario: Copying the session gives the resuming command
      When I queue "Check it"
      And the task finishes
      And I open "Check it"
      And I ask for the session
      Then the clipboard holds a command that resumes by id

    Scenario: The plain control still only changes directory
      When I queue "Check it"
      And the task finishes
      And I open "Check it"
      And I ask for a terminal
      # Having a session has not stopped "where is this happening" being a
      # question worth asking.
      Then the clipboard holds a command that changes directory there

  Rule: the buttons are a registry, so somebody else can add one

    Background:
      Given the project defines the workflow "hello" that prints "hello"
      And the project declares a plugin contributing its own task tool
      And the project "work" is registered
      And the task "Add due dates" exists on "hello" in "work"
      When I open the tasks page
      And I open "Add due dates"

    Scenario: An outsider's button appears with no change to Factory
      Then the row offers a button labelled "Acme docs"
      And it says which plugin provided it

    Scenario: Switching that plugin off takes its button away
      When I open the plugins page
      And I switch off the plugin providing "Acme docs"
      And I open the task again
      Then the row does not offer "Acme docs"

  Rule: the interface scale is the whole interface, and the rails give way

    Scaling with CSS `zoom` has two traps, and both only appear above 1×.
    `100vh` is measured in unzoomed pixels, so a full-height shell lays out
    taller than the window and the document grows a scrollbar of its own —
    which would carry the menu off the top, undoing the point. And a media
    query measures the unzoomed window, so a layout that collapses "on a narrow
    screen" never collapses however far you zoom in.

    Background:
      Given the project defines the workflow "hello" that prints "hello"
      And the task "Add due dates" exists on "hello"
      When I open the tasks page
      And I open "Add due dates"

    Scenario: At three times the size the window is still the window
      When I set the interface size to 3
      Then the page itself does not scroll
      And the shell is exactly the height of the window

    Scenario: And the rails give up their room
      When I set the interface size to 3
      Then the project rail is hidden
      And the menu is still there

    Scenario: Back at one the rail returns
      When I set the interface size to 3
      And I set the interface size to 1
      Then the project rail is shown

  Rule: nobody starts an agent without being told what one can reach

    Factory coordinates other people's coding agents against real repositories.
    Until this increment it did that with no boundary of its own and said
    nothing about it, so the first way anybody found out was by reading the
    source.

    The daemon is the gate — the CLI and `curl` start runs too — and the board's
    job is to turn its refusal into something a person can act on, wherever they
    pressed the button.

    Background:
      Given nothing has been accepted on this installation

    Scenario: Browsing costs nothing
      When I open the tasks page
      # Reading is not running. Gating the whole app would be the wrong shape:
      # the thing that needs agreement is starting an agent.
      Then the board says there is nothing yet
      And no disclaimer is in the way

    Scenario: Queueing shows what an agent can reach
      When I open the tasks page
      And I create the task "Add due dates" on "hello"
      And I queue it
      Then the disclaimer appears
      And it says what an agent can do inside the workspace
      And it names the profile that removes the boundaries
      And it says plainly that Factory is not a sandbox

    Scenario: Accepting it lets the work start
      When I open the tasks page
      And I create the task "Add due dates" on "hello"
      And I queue it
      And I accept the disclaimer
      Then the disclaimer is gone
      And "Add due dates" leaves "draft"

  Rule: Full Access is impossible to miss

    Background:
      Given the installation runs under Full Access

    Scenario: The marker is in the shell, on every page
      When I open the tasks page
      Then the Full Access marker is visible
      And it is still visible on the settings page

    Scenario: The marker survives the largest interface scale
      When I open the tasks page
      And the interface scale becomes 3
      # The rails give up their room at that scale; the nav narrows and stays,
      # which is why the marker lives there and not in a banner.
      Then the Full Access marker is visible
