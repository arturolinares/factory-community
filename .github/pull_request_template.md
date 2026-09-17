**What this changes, and why.** The diff says what; this should say why, and what it cost to find
out.

**The scenario.** Which `.feature` file states the new behaviour? A behaviour change without one
will be asked for one — see [CONTRIBUTING.md](../CONTRIBUTING.md).

**The mutations.** Which guards did you break and watch fail, and what failed?

- [ ] `pnpm typecheck && pnpm lint && pnpm test`
- [ ] `pnpm --filter @factory/web test:e2e` — if this touches the board (CI runs it too)
- [ ] Nothing here imports from the commercial workspace
- [ ] Documentation says only what the code keeps
