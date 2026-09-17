# One task waiting for another

A task can be made to wait for other tasks in the same project. It stays in the queue until they
are done, and then it starts on its own.

This is not the same thing as a workflow's `needs:`, which orders the workflows *inside* one task's
plan. Dependencies order *tasks*.

## Making one wait

On the task page, under **Waits for**, choose a task and press *Wait for it*. From a terminal:

```bash
factory task depends <id> <waits-for-id>            # the second one has to finish first
factory task depends <id> <waits-for-id> --remove   # take it back
```

Eight characters of an id is enough at either end — the same abbreviation `factory task list`
prints.

Three things are refused, with a reason, when you ask rather than later when something tries to run:

- **itself** — nothing to say about it;
- **a task in another project** — a dependency between two repositories has no owner, and the
  controls that act on a graph are project-level;
- **a ring** — `A` waits for `B` waits for `A`, however far around. Refusing at the door is what
  lets *Queue all* treat a ring as corruption rather than as an ordinary case to design around.

## What happens when it runs

Queueing always works. A task with unfinished blockers takes its place in the queue and the
*scheduler* holds it there, naming what it is waiting for. That is what lets you queue ten tasks in
one go and walk away.

Three answers, and they read differently on the board:

| The blockers are | The task | The board says |
|---|---|---|
| not all done yet | stays queued | `waiting for Scaffold` |
| all done | starts when there is room | nothing |
| one of them can never finish | becomes **blocked** | `"Scaffold" was cancelled, so this cannot start.` |

A blocker can never finish when it was cancelled, is blocked itself, or was archived without ever
finishing. Leaving the dependent in the queue would park it for ever looking like it was about to
run, which is the one thing a board exists to make obvious. Retry or re-queue the blocker and the
dependent goes back to waiting; the next tick picks it up.

A blocker that finished and was *then* archived still counts as done. Tidying up must not stall
everything behind it.

Two tasks that both wait for the same blocker are not made to wait for each other. When it finishes
they both become eligible, and how many run at once is the concurrency cap's business.

## Marking a task done by hand

Sometimes the work happened outside Factory, or turned out not to be needed. On the task page,
**Mark done**; from a terminal, `factory task done <id>`. Everything waiting for it stops waiting.

It works from `draft`, `queued` and `blocked`. Not from `running` — telling Factory that a running
task is finished would leave the agent going and the engine's own completion throwing when it got
there — and not from `awaiting_approval`, which is holding a paused run: approve or reject it first.

**What it skips is real.** There is no run, no artifacts, no evidence, and no flags earned, and the
workflows in its plan stay ticked — so progress still reads `0/7 phases` on a task that is done.
That is honest for work done by hand. It is not a way to fake a run: a workflow that `requires:` a
flag will still wait, because no workflow provided it.

## Queue all and Stop all

Both are on the board's header, and only when a project is chosen — the graph belongs to a project,
and there is no sensible meaning for "queue every task in every repository".

**Queue all** queues every `draft` and `blocked` task in the project, in dependency order, so the
queue reads in the order the work will happen. It says how many it queued and — by name — which
tasks it left alone and why, because a project whose drafts all have empty plans queues nothing at
all, and a button that answers silence looks broken. **Assign workflows first:** a task with nothing
ticked in its plan has nothing to run, so Queue all skips it. The queue is a priority rather than a barrier, so
this is not what holds the dependents back — the scheduler does that — it is so the board is
readable. Tasks with nothing ticked in their plan are listed as skipped rather than failing the
batch. Finished and cancelled tasks are left alone: one click must never set five agents on work
that already happened.

**Stop all** cancels what is in flight or in line — running, awaiting approval, queued — and kills
their processes. It asks once before doing it, because killing an agent mid-sentence has no undo.

Drafts and blocked tasks are deliberately left alone. Neither is happening, and both are what
*Queue all* picks up from: a button that cleared work you had planned but not started would be a
different button. For "stop absolutely everything, everywhere", there is `factory stop --all`.

```bash
factory project queue <name>     # the lot, in dependency order
factory project stop <name>      # cancel whatever is in flight there
```

Part of a project's name is enough, as long as it is not part of two.

## What this deliberately is not

- **Not cross-project.** See above.
- **Not a priority system.** Queue position is still first-come; a dependency is a barrier, not a
  weight.
- **Not a graph editor.** One list per task, edited one edge at a time. Two people editing the same
  task cannot overwrite each other's edges, which a whole-list save would allow.
- **Not automatic.** Nothing infers a dependency from branches, tickets or names.
