---
mode: agent
description: Remove Xaedalon Factory from this machine, keeping the user's data.
---

<!-- The editor's prompt-file convention. The Copilot CLI does not read this: it discovers skills
     from `.github/skills/`, `.agents/skills/` and `.claude/skills/`, and finds this one in the
     last of those — verified with `copilot skill list`. -->

Read `skills/factory-uninstall/SKILL.md` at the root of this repository and follow it exactly.

It is the only copy of the steps. Before you begin: inventory first, while Factory can still say
where its files are; stop the agents before the daemon; and by default remove the software but keep
the data — the user's definitions, history, artifacts and repositories are named with the command
and left alone.
