# The Full Access profile

Everything the Default profile withholds, given back.

```bash
factory profile full-access     # for this installation
```

Under Full Access, Factory launches agents the way it launched them before there
were profiles at all: with their own CLI's confinement switched off, and with
the whole environment the daemon has — including every credential in it.

## What it is for

- A disposable VM, or a machine you can restore.
- Work that genuinely has to reach outside the project: a monorepo split across
  directories Factory has not been told about, a tool that writes to your home
  directory, a script that needs your cloud credentials.
- Finding out whether the Default profile is what is blocking you. If a workflow
  fails under Default and works under Full Access, the difference is a boundary,
  and the fix is usually to grant one directory rather than to stay here.

## What it changes

| | Default | Full Access |
|---|---|---|
| Files outside the workspace | refused by the agent's CLI | allowed |
| Credentials in the environment | withheld unless the provider needs them | all of them |
| A phase naming a directory outside the workspace | refused at plan time | allowed, with a warning |

## What it does not change

Everything Factory does to *watch* a run stays exactly as it was: the run
history, the step timeline, the logs, the evidence, the recorded profile, and
the kill switch. Full Access removes boundaries, not observability.

```bash
factory stop --all      # still stops every agent, and cancels its task
```

## How you are reminded

A project running under Full Access is marked in the interface at all times —
in the left-hand navigation, on every page, at every interface scale. Each run
records the profile it was given, so a run that happened under Full Access still
says so months later, after the project has been set back to Default.

This is deliberate. The failure mode for a profile like this is not choosing it;
it is forgetting you chose it.
