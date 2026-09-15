Feature: Projects — the repositories Factory works in
  Everything before this ran wherever the daemon happened to be started, which
  is fine for one repository and wrong for two. A project says where a piece of
  work happens: a name, a path, the branch work starts from, and where its
  worktrees go.

  A task belongs to a project, or to none — `factory run` in a directory needs
  no project, and refusing to record work without one would mean the only tasks
  Factory can keep are the ones created through the board.

  The path is checked when it is written rather than when something tries to run
  there. A project pointing at a directory that does not exist fails at the
  moment someone can still fix it easily, not in the middle of a run.

  A project decides whether each of its tasks gets a worktree of its own. When it
  does not, work happens in the repository itself — which is a reasonable thing
  to want, and has one consequence that cannot be negotiated: two agents in one
  working copy overwrite each other, so that project runs one task at a time.
  Somewhere without a `.git` directory cannot have worktrees at all, so it works
  that way from the start.

  Background:
    Given an empty store
    And a directory that is a git repository

  Scenario: Adding a project
    When I add the project "factory" at that directory
    Then the project is stored
    And the project's branch is "main"
    And the project has somewhere to put worktrees

  Scenario: A project needs a directory that exists
    When I add the project "ghost" at a path that does not exist
    Then it is refused
    And the error names the path

  Scenario: A project needs a directory, not a file
    When I add the project "afile" at a file
    Then it is refused

  Scenario: A directory that is not a repository is allowed, and said so
    Given a directory that is not a git repository
    When I add the project "notes" at that directory
    Then the project is stored
    And the project is marked as not being a repository

  Scenario: Names are unique
    Given the project "factory" exists
    When I add the project "factory" at that directory again
    Then it is refused
    And the error says the name is taken

  Scenario: A task can belong to a project
    Given the project "factory" exists
    When I create a task "Add due dates" in "factory"
    Then the task belongs to "factory"

  Scenario: A task need not belong to one
    When I create a task "Add due dates" with no project
    Then the task belongs to no project

  Scenario: Removing a project leaves its tasks without one
    Given the project "factory" exists
    And a task "Add due dates" in "factory"
    When I remove the project
    Then the task still exists
    And the task belongs to no project

  Scenario: Projects are listed by name
    Given the project "zebra" exists
    And the project "alpha" exists
    When I list the projects
    Then they are "alpha, zebra" in that order

  Scenario: A project gives each task its own worktree unless it says otherwise
    When I add the project "factory" at that directory
    Then the project uses worktrees

  Scenario: A project can be added to work in its own checkout instead
    When I add the project "factory" at that directory, working in place
    Then the project does not use worktrees
    And the project still remembers where worktrees would go

  Scenario: A directory that is not a repository works in place from the start
    Given a directory that is not a git repository
    When I add the project "notes" at that directory
    Then the project does not use worktrees

  Scenario: Asking for worktrees where there is no repository is refused
    Given a directory that is not a git repository
    When I add the project "notes" at that directory, using worktrees
    Then it is refused
    And the error says it is not a git repository

  Scenario: Worktrees can be turned off after the project was added
    Given the project "factory" exists
    When I turn its worktrees off
    Then the project does not use worktrees

  Scenario: Turning worktrees back on needs a repository
    Given a directory that is not a git repository
    And the project "notes" exists there
    When I turn its worktrees on
    Then it is refused

  Scenario: Turning worktrees on notices a directory that has since become one
    Given a directory that is not a git repository
    And the project "notes" exists there
    And the directory becomes a git repository
    When I turn its worktrees on
    Then the project uses worktrees
    And the project is no longer marked as not being a repository

  Scenario: Changing the setting is announced
    Given the project "factory" exists
    When I turn its worktrees off
    Then a "project.changed" event says so

  Scenario: Changing a project that is not there is refused
    When I turn worktrees off on a project that does not exist
    Then it is refused

