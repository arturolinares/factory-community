# What each agent CLI enforces

Per provider: how autonomy is enabled, what the CLI confines for itself, what
Factory adds, and — separately — **which of it has actually been measured.**

This page exists because the honest answer differs per CLI, and because a
security page that averaged them would be wrong about all three.

## Claude Code

**Measured** against 2.1.273 on 2026-09-15, by running it against a confined
workspace and reading what happened.

| | |
|---|---|
| Default | `--restricted --tools Bash,Edit,Write,Read,Glob,Grep,… --permission-mode acceptEdits --permission-prompts none` |
| Full Access | `--permission-mode bypassPermissions` |
| Extra directories | `--add-dir <path>` |

What was observed under Default, in a neutral directory:

```text
write a file in the workspace        OK
run a shell command                  OK
write a file outside the workspace   REFUSED
shell redirection outside it         REFUSED
```

The third and fourth are the useful ones. `--restricted` confines the file
tools *and* the shell's writes, which is more than the flag's own description
promises. The run never blocks waiting for a person, because
`--permission-prompts none` denies anything that would prompt rather than
waiting for an answer nobody is there to give.

Two configurations that read correctly and did not work, recorded so nobody
tries them again: `--tools default` does **not** name the code-running tools
back in — the session had no Bash at all — and `--permission-mode dontAsk` means
"do not ask, and deny", which refused every write.

**Known limitation:** in `--print` mode, a settings file that fails validation
is ignored silently. Factory does not rely on one, for that reason.

## GitHub Copilot CLI

**Reasoned, not measured.** Probing it needs a GitHub login and spends the
user's Copilot quota, so what follows is read off `--help` for 1.0.83 — and it
is a smaller claim than Claude's, because it describes flags being *withheld*
rather than a mode being relied on.

| | |
|---|---|
| Default | `--allow-all-tools` |
| Full Access | `--allow-all` |
| Extra directories | `--add-dir <path>` |

This CLI verifies file paths by default. `--allow-all-paths` is documented as
"Disable file path verification and allow access to any path", and
`--allow-all-urls` does the same for the network. Factory used to pass both, so
it was switching off confinement the provider already had; Default no longer
passes either. `--allow-all-tools` is unchanged and is required for
non-interactive use.

**What this necessarily allows:** Copilot needs a GitHub token to work, so
Default passes `GH_TOKEN`/`GITHUB_TOKEN` through. A Copilot step can therefore
reach GitHub with your credentials — including pushing. That is the cost of the
provider needing the credential at all, and it is written here rather than
implied.

**Not known:** how this CLI words a refusal. Factory therefore detects none of
them for Copilot, and will not pretend to until somebody runs it and reads the
output.

## OpenAI Codex

**Nothing has been measured.** The CLI is not installed on the machine this
descriptor was written on, and its descriptor is marked `provisional` for that
reason — `factory doctor` says so out loud.

| | |
|---|---|
| Default | *(nothing)* |
| Full Access | *(nothing)* |

Codex's documentation describes a `--sandbox workspace-write` mode that looks
like exactly the right Default. It is deliberately **not** configured here.
Writing a flag that reads correctly and does nothing is a mistake this project
has now made three times — `claude -c`, `diffity --new`, and `--tools default`
— and the third was inside this very increment.

Under Default, a Codex run is confined by Factory's own boundary and filtered
environment, and by nothing the CLI does. Doctor reports that too.

## The general shape

Factory's own guarantees do not vary by provider: the working directory, the
filtered environment, the refused `working_dir`, the process group and the kill
switch. Everything in the table above is *in addition* to those, and is the
part that differs.

If you add a provider, say what its refusals look like in its descriptor's
`denialPatterns` — and say nothing if you have not seen one.
