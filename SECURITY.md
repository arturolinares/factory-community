# Security

Factory starts coding agents that write to your repositories. Its boundaries are the whole point of
it, so a hole in one is worth reporting and worth fixing quickly.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** on this repository: *Security → Report a
vulnerability*. It opens a private thread with the maintainers; nothing is public until there is
something to say.

Please do not open a public issue for a boundary escape, a sandbox bypass, or anything that leaks a
credential.

What helps, in order: the version or commit, the execution profile in force, the workflow or step
that triggered it, and what you observed versus what the documentation promised. A failing `.feature`
scenario is the most useful bug report this project can receive, because it becomes the regression
test.

## What Factory does and does not guarantee

Read [`docs/security/default-profile.md`](docs/security/default-profile.md) first — it is short, and
it is the profile every project gets. The one sentence worth repeating here:

> **Factory is not a sandbox.** Under the Default profile an agent is confined to the task's
> workspace by the flags its own CLI provides, and given an environment with credentials removed.
> Confinement is enforced by the agent's CLI, not by the operating system.

So the following are **known limits, not vulnerabilities**:

- an agent running arbitrary commands *inside* its own workspace, including network access — that is
  what it is for;
- anything reachable under the **Full Access** profile, which exists to remove the boundary and says
  so on every page while it is on;
- a step you wrote sending data anywhere — Factory does not inspect step commands;
- a `.factory` directory in a repository you added being trusted, the way a `Makefile` in a
  repository you cloned is trusted.

These **are** vulnerabilities, and worth reporting:

- a Default-profile agent writing outside its workspace, or reading a credential the environment
  filter should have withheld;
- a path in an API request escaping the directory it is resolved against;
- the daemon answering on anything but `127.0.0.1`, or a request from another origin being served;
- `cancel` or *Stop all* leaving a process alive;
- the disclaimer gate being bypassable by a client;
- anything in an artifact rendering as script in the board.

## Supported versions

Until 1.0, the latest `main` is the supported version. There are no backports yet.
