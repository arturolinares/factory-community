Feature: What counts as inside the workspace

  The whole `default` profile rests on one sentence — "everything inside the
  active workspace is trusted; crossing the boundary needs permission" — and
  until now the codebase contained exactly one containment check, for static
  assets. Nothing canonicalised a workspace, a worktree, or the directory a step
  runs in.

  Two paths got in through that gap. A phase's `working_dir` is joined with
  `joinPath`, whose absolute part restarts the path, so `working_dir: /tmp` ran
  in `/tmp`. And `task.directory` arrived from a client, was stored verbatim,
  and became the agent's own directory.

  `canonical` is a parameter, the way `workspaceFor` takes `exists`, so the rule
  can be exercised without a filesystem — and the one implementation that needs
  `node:fs` is tested separately, against a real symlink, because that is the
  case a lexical check cannot answer.

  Scenario: A directory under the workspace is inside it
    Given the workspace is "/repos/todolist"
    When I check "/repos/todolist/src/api"
    Then it is inside the workspace

  Scenario: The workspace itself is inside it
    Given the workspace is "/repos/todolist"
    When I check "/repos/todolist"
    # A step running in the project root is the ordinary case, not an escape.
    Then it is inside the workspace

  Scenario: A trailing separator does not change the answer
    Given the workspace is "/repos/todolist/"
    When I check "/repos/todolist"
    Then it is inside the workspace

  Scenario: Somewhere else entirely is outside
    Given the workspace is "/repos/todolist"
    When I check "/tmp"
    Then it is outside the workspace

  Scenario: The parent of the workspace is outside
    Given the workspace is "/repos/todolist"
    When I check "/repos"
    Then it is outside the workspace

  Rule: a sibling whose name starts the same way is not inside

    This is why the check appends the separator instead of using a bare
    `startsWith`. It is the classic prefix bug, and here it would hand an agent
    a whole neighbouring repository while every test about climbing out still
    passed.

    Scenario: A sibling sharing a prefix is outside
      Given the workspace is "/repos/todo"
      When I check "/repos/todolist/src"
      Then it is outside the workspace

    Scenario: A sibling sharing a prefix exactly is outside
      Given the workspace is "/repos/todo"
      When I check "/repos/todolist"
      Then it is outside the workspace

  Rule: the check is on the resolved path, not the written one

    `/repos/todolist/../secrets` reads as if it were inside and is not. Whatever
    resolves the path has to run before the comparison, never after, because the
    operating system resolves it either way when the process starts.

    Scenario: Climbing out with ".." is outside
      Given the workspace is "/repos/todolist"
      And "/repos/todolist/../secrets" really means "/repos/secrets"
      When I check "/repos/todolist/../secrets"
      Then it is outside the workspace

    Scenario: Climbing out and back in again is inside
      Given the workspace is "/repos/todolist"
      And "/repos/todolist/../todolist/src" really means "/repos/todolist/src"
      When I check "/repos/todolist/../todolist/src"
      Then it is inside the workspace

    Scenario: A link out of the workspace is outside
      Given the workspace is "/repos/todolist"
      And "/repos/todolist/etc" really means "/etc"
      When I check "/repos/todolist/etc"
      # The case no amount of string handling answers, and the reason the real
      # implementation calls realpath rather than resolve alone.
      Then it is outside the workspace

    Scenario: A workspace that is itself a link is compared as what it is
      Given the workspace is "/repos/todolist"
      And "/repos/todolist" really means "/mnt/work/todolist"
      And "/repos/todolist/src" really means "/mnt/work/todolist/src"
      When I check "/repos/todolist/src"
      # Both sides are resolved, or a worktree reached through a symlinked home
      # would be refused on every machine that has one.
      Then it is inside the workspace

  Rule: the real implementation resolves links, and says what it cannot do

    Everything above drives a lookup table. This drives the filesystem, because
    the guarantee being claimed is about symlinks and a table cannot be wrong
    about those in the same way the implementation can.

    Scenario: A real link out of a real workspace is refused
      Given a real directory with a link in it pointing outside
      When I check the link with the real implementation
      Then it is outside the workspace

    Scenario: A real directory inside a real workspace is allowed
      Given a real directory with a link in it pointing outside
      When I check a real subdirectory with the real implementation
      Then it is inside the workspace

    Scenario: A path that does not exist yet is resolved lexically
      Given a real directory with a link in it pointing outside
      When I check a subdirectory that has not been created yet
      # A worktree a later phase creates does not exist at plan time. Refusing
      # it would break the worktree-first workflow this profile is built around,
      # so the fallback is deliberate and documented as a limit.
      Then it is inside the workspace

  Rule: the refusal explains itself in one wording

    The sentence reaches a person in three places — a refused run's detail, a
    doctor warning and the board. Written once, so it cannot read differently
    depending on which one you are looking at.

    Scenario: The refusal names the path, the workspace and the way out
      Given the workspace is "/repos/todolist"
      When I ask why "/tmp" was refused
      Then the reason names "/tmp"
      And the reason names "/repos/todolist"
      And the reason says which profile allows it
