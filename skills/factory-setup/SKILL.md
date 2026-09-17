---
name: factory-setup
description: Install Xaedalon Factory on this machine and leave it running — prerequisites, build, user scope, daemon, and a board that answers. Use when the user asks to install, set up, or get Factory working, or invokes /factory-setup. Not for using Factory once it runs (that is `factory setup`, `factory doctor`, and the board).
---

# Setting up Factory

You are installing **Xaedalon Factory** for the person you are talking to, on the machine you are
running on, and leaving it working. Factory is one Node process plus a SQLite file; there is no
service to register and nothing to configure before the first run.

This runbook is written for any coding agent. The command sequence below is the same one the
project's own `first-run` CI job executes on every commit, so if a step here fails on a supported
platform, that is a bug worth reporting rather than something to work around.

---

## Rule one: say what you are about to do, then do it

**Before running anything**, tell them in plain language — short, no jargon, no list of internal
detail:

> I'll set up Factory here. In order: check you have Node 24+, pnpm and git; clone the repository
> into `<the directory you propose>`; install its dependencies and build it; create your Factory
> scope at `~/.xaedalon/.factory`; start the local daemon on `127.0.0.1:7317`; then confirm the
> board answers and tell you what is left to do.
>
> It installs nothing globally, changes nothing outside that directory and your home scope, and
> never reaches the network except to fetch the repository and its npm dependencies. I will not
> start any agent or accept Factory's security notice for you — both are your call.

Name the actual directory you intend to use, and ask before choosing one they did not mention. Then
proceed without further prompting unless something below says to stop.

## Rule two: three things are theirs to decide, not yours

1. **Never accept the security disclaimer.** Factory refuses to start an agent until somebody has
   read what an agent run can reach. Show them `factory accept --show` at the end and leave it.
2. **Never queue a task or run a workflow** as part of setup. Setup ends with a working installation,
   not with an agent editing their code.
3. **Never install a coding-agent CLI** (Claude Code, Codex, Copilot) without asking. Report which
   are present and let them choose.

---

## 1. Platform

Work out which of three situations you are in, and say which.

**macOS or Linux** — proceed directly.

**Windows** — everything must happen **inside WSL2**. This is not a preference: every shell step
Factory runs is `bash -c '…'`, and stopping work signals a POSIX process group. Neither exists on
native Windows, so a "successful" native install would fail the first time it ran or stopped
anything.

```powershell
wsl --status
wsl -l -v            # a distribution, "Version 2", and ideally "Running"
```

- **A WSL2 distribution exists** → run every remaining command inside it (`wsl -d <name> -- <cmd>`,
  or tell them to open their WSL shell and continue there). Install into the Linux filesystem,
  e.g. `~/factory`, **not** `/mnt/c/...` — a repository on the Windows drive makes Node and git
  slow enough to look broken.
- **No WSL2** → stop and say exactly this: *Factory needs WSL2 on Windows. Run `wsl --install` in an
  administrator PowerShell, reboot, then ask me again.* Do not attempt a native install, and do not
  install WSL for them without asking — it requires a reboot.

The board is reachable from a Windows browser at `http://127.0.0.1:7317` once the daemon runs inside
WSL2.

## 2. Prerequisites

Check, report, and only then fix — and say what you are installing before you install it.

```bash
node --version      # must be >= 24. The store uses node:sqlite.
git --version
corepack --version
```

- **Node older than 24, or missing.** Do not silently install a Node. Ask, and prefer their existing
  manager if you can see one (`nvm`, `fnm`, `asdf`, `volta`, `brew`, `apt`). `nvm install 24 && nvm
  use 24` is the usual answer on macOS and Linux. Node 24 is a hard floor, not a recommendation: on
  anything older, `import 'node:sqlite'` throws and the daemon cannot start.
- **pnpm.** `corepack enable pnpm` is enough — the exact version is pinned in the repository's
  `packageManager` field and corepack fetches it. Do not `npm i -g pnpm`.
- **git missing.** macOS: `xcode-select --install`. Debian/Ubuntu: `sudo apt-get install -y git`.
  Ask first.

## 3. Get the repository

If the current directory is already a checkout of `factory-community` (it has `PROJECT.md` and
`pnpm-workspace.yaml`), use it and say so. Otherwise:

```bash
git clone https://github.com/xaedalon/factory-community.git ~/factory
cd ~/factory
```

Propose `~/factory` unless they have said where they want it. On Windows this must be a WSL path.

## 4. Build

```bash
corepack enable pnpm
pnpm install
pnpm build
```

`pnpm build` produces three things: the engine and daemon, the `factory` CLI, and the board the
daemon serves from the same process. Confirm the third exists, because it is the one that used to be
missing:

```bash
test -f apps/web/dist/index.html && echo "board built"
```

If that file is absent, run `pnpm --filter @factory/web build` and report it — the root build is
supposed to cover it.

## 5. Create their scope

```bash
node apps/cli/dist/bin.js init --scope user
```

`--scope user` is deliberate. Without it, `init` inside a git repository creates a **project** scope
in that repository — right for a repository's own workflows, wrong for a first run, because their
definitions would then live inside a checkout they will later pull or delete.

This writes `~/.xaedalon/.factory/` with `config.yaml`, `workflows/` and `phases/`.

## 6. Start the daemon and prove it answers

Start it detached, so it survives the shell you started it in:

```bash
mkdir -p ~/.factory
node apps/daemon/dist/bin.js > ~/.factory/daemon.log 2>&1 &
```

The `mkdir` is load-bearing on a machine that has never run Factory: the daemon creates `~/.factory`
itself, but the shell's redirect happens first, so without it the command fails with *No such file
or directory* and no daemon starts. Verified by running this sequence against an empty home
directory — it failed exactly there.

On Windows-in-WSL, the same command inside the WSL shell. If they would rather run it in the
foreground in their own terminal, say so and let them — then skip to the checks below once it is up.

Wait for it, then check both halves:

```bash
curl -sf http://127.0.0.1:7317/api/health     # {"ok":true,...}
curl -sf http://127.0.0.1:7317/ | head -c 40  # the board's HTML
```

- **Health answers, `/` returns a page saying the board is not built** → the build skipped the web
  bundle. `pnpm --filter @factory/web build`, then reload.
- **Nothing answers on 7317** → read `~/.factory/daemon.log`. If the port is taken by something
  else, start it on another with `FACTORY_PORT=7417` and use that port everywhere afterwards.
- **`EADDRINUSE` and the log says a Factory is already listening** → they already have one running.
  Say so; do not start a second.

## 7. Ask Factory what is left

```bash
node apps/cli/dist/bin.js setup
```

This is Factory's own answer, not yours: it lists what is missing and the command that fixes each
thing, and it asks the provider plugins rather than guessing. Relay it as it stands. Expect it to
report which coding-agent CLIs it found — Factory runs the CLI they already have and never installs
one.

If they want `factory` on their PATH rather than `node apps/cli/dist/bin.js`:

```bash
pnpm --filter @factory/cli link --global
```

Offer it; do not do it unasked, since it writes into their global pnpm directory.

## 8. Hand it over

Report, briefly and concretely:

- **the board**: `http://127.0.0.1:7317`
- **where things are**: the checkout, `~/.xaedalon/.factory/` for definitions,
  `~/.factory/state/factory.db` for what happened
- **how to stop it**: `factory stop --all` stops every agent and cancels its task; killing the
  daemon process stops the daemon
- **what is theirs to do next**, in this order:
  1. `factory accept --show` — read what an agent run can reach, then `factory accept`. Nothing will
     run until they do, and that is on purpose.
  2. Add a repository on the Projects page, or `factory project …` from the terminal.
  3. Import the example pipeline if `factory setup` offered it, or build a workflow in the browser.
- **anything you could not finish**, named plainly.

Then stop. Do not create a project, do not create a task, and do not queue anything.

---

## If they already have Factory

Say so rather than reinstalling. Verify and repair instead:

```bash
git -C <checkout> pull
pnpm install
pnpm build
node apps/cli/dist/bin.js doctor      # what the installation thinks is wrong
```

A daemon started before an upgrade is running the old code: tell them to restart it, and never
restart one that is mid-run without asking — `factory task list` shows whether anything is running.

## What this deliberately does not do

- It does not make Factory start at login. There is no service or launch agent; a tool that runs
  coding agents against repositories should start when somebody starts it.
- It does not open any port other than loopback. Nothing here listens on `0.0.0.0`, and if they ask
  for that, point them at the security documentation first.
- It does not configure a provider's credentials. Factory never asks for an API key; it runs the
  agent CLI they have already authenticated.
- It does not set the execution profile. **Default** is the profile every project gets; Full Access
  removes the workspace boundary and is their explicit choice, per project.

## Reference

Inside the checkout: [`docs/install.md`](../../docs/install.md) for requirements and where things
live, [`docs/quickstart.md`](../../docs/quickstart.md) for the first task,
[`docs/security/default-profile.md`](../../docs/security/default-profile.md) for what an agent may
reach, and [`PROJECT.md`](../../PROJECT.md) for why any of it is shaped this way.
