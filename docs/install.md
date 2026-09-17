# Installing

Factory is one Node process and a SQLite file. There is no service to register, no container, and
nothing to configure before the first run.

## What you need

| | |
|---|---|
| **Node 24 or newer** | The store uses `node:sqlite`, which does not exist before Node 22.5 and is only settled in 24. An older Node fails at import rather than at install. |
| **pnpm** | `corepack enable pnpm` — the version is pinned in `package.json` (`packageManager`), so corepack fetches the right one. |
| **git** | Factory works in repositories, and the worktree workflows use `git worktree`. |
| **A coding agent, if you want one to run** | Claude Code, Codex or GitHub Copilot CLI. Factory never installs one and never asks for an API key: it runs the CLI you already have. `factory provider list` says which it found. |

## Platforms

**macOS and Linux are supported.** Both are exercised by the test suite in CI, and macOS
additionally by the browser suite.

**Windows: use WSL2.** Not a preference — two things Factory does have no Windows equivalent today:

- every shell step runs as `bash -c '…'`, including the built-in worktree steps;
- stopping work signals a **process group** (`SIGTERM`, then `SIGKILL`), which is how one click can
  stop an agent whose actual work is a grandchild process.

Inside WSL2 both hold, and the board is reachable from a Windows browser at `127.0.0.1:7317`. Native
Windows support means replacing both mechanisms rather than patching around them, and it is not
pretended at until it is measured. See [`../PROJECT.md`](../PROJECT.md) for how this project treats
claims it has not watched fail.

## Install

```bash
git clone https://github.com/xaedalon/factory-community.git
cd factory-community
corepack enable pnpm
pnpm install
pnpm build                                      # engine, CLI and board
```

`pnpm build` produces three things: the engine and daemon, the `factory` CLI, and the board that the
daemon serves from the same process. If the board is missing, the daemon starts anyway and says so
on `/` — the API is useful without it.

## First run

```bash
node apps/cli/dist/bin.js init --scope user     # ~/.xaedalon/.factory
node apps/daemon/dist/bin.js                    # http://127.0.0.1:7317
```

Then open `http://127.0.0.1:7317`.

Without `--scope user`, `init` inside a git repository creates a **project** scope in that
repository. That is the right thing for a repository's own workflows and the wrong thing for your
first run, when you want definitions that outlive any one checkout.

`factory setup` is the next command to run: it lists what is missing and the command that fixes each
one, and it asks the engine and the provider plugins rather than guessing.

## Putting `factory` on your PATH

Nothing is published to npm yet, so the CLI is reachable by path (`node apps/cli/dist/bin.js …`) or
by linking the workspace package:

```bash
pnpm --filter @factory/cli link --global        # then: factory task list
```

Undo it with `pnpm --filter @factory/cli unlink --global`.

## Where things are kept

| | |
|---|---|
| `~/.xaedalon/.factory/` | the user scope: `config.yaml`, `workflows/`, `phases/`, `agents/` |
| `~/.factory/state/factory.db` | tasks, runs, logs and evidence |
| `<repo>/.xaedalon/.factory/` | a project's own definitions, committed with the repository |
| `FACTORY_HOME` | overrides the user scope — what the test suites use, and what a second installation on one machine would use |
| `FACTORY_PORT`, `FACTORY_WEB_PORT` | the daemon's port and the dev server's; both default to loopback only |

Nothing listens on anything but `127.0.0.1`, deliberately. A tool that runs coding agents against
your repositories has no business being reachable from the network.

## Upgrading

```bash
git pull
pnpm install
pnpm build
```

The daemon migrates its database on start and reconciles anything a previous stop left half-done —
`factory doctor` reports what it found.
