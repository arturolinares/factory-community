---
name: factory-uninstall
description: Remove Xaedalon Factory from this machine — stop its agents, take out the software, and report exactly what was left and why. Use when the user asks to uninstall, remove or get rid of Factory, or invokes /factory-uninstall. Not for removing one project or task from Factory (that is the board, or `factory project`).
---

# Removing Factory

The runbook is [`skills/factory-uninstall/SKILL.md`](../../../skills/factory-uninstall/SKILL.md), at
the root of this repository. **Read it now and follow it exactly.**

One copy of the steps, three agents — the same arrangement as `factory-setup`, and for the same
reason: a fix to what an uninstaller may touch has to be a fix everywhere.

Three things it says that matter before you open it. Take the inventory *before* stopping anything,
while Factory can still tell you where its files are. Stop the agents before the daemon, or you
orphan their process groups. And the default removes the software and keeps the data — their
definitions, their history, and anything Factory wrote inside their repositories are named with the
command and left alone.
