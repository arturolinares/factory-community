---
mode: agent
description: Install Xaedalon Factory on this machine and leave it running.
---

<!-- This is the prompt-file convention Copilot uses inside an editor. The
     Copilot *CLI* does not read it: it discovers skills from `.github/skills/`,
     `.agents/skills/` and `.claude/skills/`, and the last of those is where
     this repository's skill lives — verified with `copilot skill list`. Kept
     because an editor is where many people will ask. -->

Read `skills/factory-setup/SKILL.md` at the root of this repository and follow it exactly.

It is the only copy of the steps — Claude Code, Codex and Copilot all point at it, so that a fix to
the install path is a fix for every agent. Two of its rules matter before you begin: explain the
whole plan to the person before running anything, and never accept Factory's security disclaimer on
their behalf.
