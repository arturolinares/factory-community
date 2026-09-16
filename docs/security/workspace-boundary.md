# The workspace boundary

What counts as inside, and what is not enforced.

```
/repos/todolist                          the project
/repos/.factory-worktrees/todolist/…     a task's own workspace
/repos/todolist/.xaedalon/.factory/…     where its artifacts go
```

The Default profile rests on one sentence: *everything inside the active
workspace is trusted, and crossing the boundary needs permission.* This is what
that sentence means precisely enough to rely on.

## The workspace

A task's workspace is its own git worktree where the project uses worktrees, and
the project's checkout otherwise. Factory decides it — a client cannot name a
directory — and the name comes from the task, slugged to a single path segment
so there is nothing in it that could climb out.

## What is compared, and how

A path is inside the workspace if it *is* the workspace or sits under it. Both
sides are resolved first, so:

- `<workspace>/../secrets` is outside, because the comparison is on the resolved
  path and not the written one.
- `/repos/todolist` is **not** inside `/repos/todo`. A sibling whose name starts
  the same way is a different directory.
- a symlink inside the workspace pointing at `/etc` is outside, because
  resolution follows links.
- a workspace that is *itself* reached through a symlink still contains its own
  children — both sides are resolved, so a repository under a symlinked home
  directory is not refused.

A path that does not exist yet is resolved as far as it does exist. That case
matters: a worktree is usually created by an earlier phase of the very workflow
being planned, and refusing a plan because a directory is not there yet would
make worktree-first workflows impossible.

## What is inside besides the workspace

Two things, both deliberate:

- **The artifacts directory.** A task's artifacts live under the *project*, not
  under the worktree, so that an artifact outlives the work that produced it. A
  confined agent is therefore told to write outside its own working directory,
  and Factory grants that one directory explicitly.
- **Anything the project has granted.** "Allow for this project" records a
  directory, and every later run gets it. Absolute paths only.

## What is not enforced

Said plainly, because the value of a boundary is knowing where it stops.

- **Reading.** Confinement is about writing. An agent can read anything your
  user can read, and a shell command can read anything at all.
- **The network.** Not restricted in this version. An agent can reach whatever
  the machine can reach.
- **Anything a shell command does that its CLI does not mediate.** Factory
  passes flags to an agent CLI and the CLI enforces them. How much of a shell
  command that covers varies by provider, and
  [`providers.md`](providers.md) is the only honest answer.
- **A link created during a run.** A path that did not exist at plan time cannot
  be checked for symlinks. The provider's own confinement catches this one,
  which is why the profile is layered rather than resting on Factory alone.

## What Factory itself guarantees

Independent of any provider:

- the process starts in the workspace and nowhere else;
- a phase naming a directory outside it is refused before anything runs;
- the environment it is handed has had credential-shaped variables removed;
- the process leads its own process group, so Factory can stop it and
  everything it started.
