# The Default profile

What an agent may do when nobody has said otherwise.

```bash
factory accept --show    # what you are agreeing to
factory profile          # which profile new projects get
```

Factory runs other people's coding agents against your repositories. The Default
profile is the answer to "how much of my machine does that give them?", and the
answer is meant to be useful rather than merely reassuring: an agent that cannot
run your tests is an agent you will switch the profile off for.

## What it allows, without asking

Inside the task's workspace — its own git worktree where the project uses them,
the checkout otherwise — an agent may read, create, edit, move and delete files,
and run development commands. No approval, no prompts, no interruptions. That
includes installing the project's dependencies, running its tests, starting its
containers and making local commits.

There is no allow-list of tools. Factory does not know what your project needs,
and a profile that broke `npm test` on an unfamiliar repository would be turned
off by everyone on their first afternoon.

## What it does not allow

- **Writing outside the workspace.** The agent CLI is launched with flags that
  confine its file tools to the working directory. What that covers varies by
  provider — [`providers.md`](providers.md) says exactly how much, per CLI.
- **Credentials that look like credentials.** Cloud keys, registry tokens, the
  SSH agent socket and anything whose name contains `TOKEN`, `SECRET`,
  `PASSWORD`, `CREDENTIAL` or ends `_API_KEY` are withheld from the process.
  The one exception is the agent's own credential, which its provider declares.
- **A phase that names a directory outside the workspace.** `working_dir: /tmp`
  is refused at plan time rather than run there.

When something is withheld, the run says so against the step that lost it —
names only, never values. When an agent is refused something, the refusal is
recorded on the run, with the path if the refusal named one.

## What it is not

**Factory is not a sandbox, and the Default profile does not make it one.** It
constrains what Factory launches and what that process can see. An agent running
arbitrary shell commands is not fully containable by either: a command can read
anything your user can read, and nothing here prevents it. Network access is not
restricted at all in this version.

What you get is a meaningful reduction in blast radius and an honest account of
where it stops. Use Factory on work you can review and revert.

## What happens when something is refused

Two cases, because a refused agent does not always fail.

- **The run failed.** It is *paused* rather than blocked: the task moves to
  awaiting approval, keeps its place, and approving it continues from the phase
  that stopped rather than from the beginning.
- **The run succeeded anyway.** It is left alone — the work that mattered may
  well be done, and interrupting it would defeat the point — and the refusal is
  recorded so nobody has to find out by reading a transcript.

Either way the remedy is the same: allow the directory for that project, or run
that project under [Full Access](full-access.md).

## Where the setting lives

```
~/.xaedalon/.factory/settings.json   security.profile, and what you accepted
```

A project overrides the installation's choice, and a project that has never
chosen follows it — so changing the installation's default changes every project
that has not picked for itself. Set a project's on the Projects page, or read
the installation's with `factory profile`.
