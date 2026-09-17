---
name: factory-setup
description: Install Xaedalon Factory on this machine and leave it running — prerequisites, build, user scope, daemon, and a board that answers. Use when the user asks to install, set up, or get Factory working, or invokes /factory-setup. Not for using Factory once it runs (that is `factory setup`, `factory doctor`, and the board).
---

# Setting up Factory

The runbook is [`skills/factory-setup/SKILL.md`](../../../skills/factory-setup/SKILL.md), at the
root of this repository. **Read it now and follow it exactly.**

It lives there rather than here because three agents are supported — Claude Code, Codex and
Copilot — and the steps must not exist in three places. The one at the root is the only copy; this
file is how Claude Code finds it.

Two things it says that are worth knowing before you open it: explain the whole plan to the person
before running anything, and never accept Factory's security disclaimer on their behalf.
