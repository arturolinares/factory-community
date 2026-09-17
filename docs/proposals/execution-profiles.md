# Xaedalon Factory — Execution Profiles & Safety Architecture

**Status:** Proposed implementation standard — a target, not a description  

**Audience:** AI implementation agents, maintainers, security reviewers  
**Scope:** Xaedalon Factory Community and Factory Pro  
**Primary goal:** Preserve a high-autonomy developer experience while introducing enforceable execution boundaries, clear user expectations, and extensible permission profiles.

---

---

> **Read this second.** This document is the standard Factory is being built
> against, and most of it is not built yet. It is kept here because a public
> repository should say what it is aiming at, not because it describes what
> ships.
>
> For what is true today, and the limits of it:
>
> - [`default-profile.md`](../security/default-profile.md) — what an agent may do, and what
>   it may not
> - [`full-access.md`](../security/full-access.md) — what turning the boundary off means
> - [`workspace-boundary.md`](../security/workspace-boundary.md) — what counts as inside,
>   and what is *not* enforced
> - [`providers.md`](../security/providers.md) — per agent CLI: how much of the confinement
>   is theirs, how much is Factory's, and which of it has actually been measured
>
> Sections 1–5, 8–9, 15–16, 19–21, 23–25, 28–30, 40 and 44–46 are wholly or
> partly implemented. Network policy (§10), secrets as resources (§12), database
> policy (§14), execution limits (§17), checkpoints (§18), custom profiles
> (§26–27), MCP resources (§33), multi-root workspaces (§31–32) and production
> labelling (§39) are not.

---

# 1. Core Principle

Xaedalon Factory should maximize:

- agent autonomy;
- execution speed;
- low-friction development;
- useful access to the active project;
- minimal approval interruptions;

while minimizing unnecessary authority over:

- the rest of the developer machine;
- unrelated repositories;
- personal credentials;
- production systems;
- external services;
- irreversible actions.

The guiding principle is:

> **Maximize autonomy while constraining authority.**

Operationally:

> **Everything inside the active Factory workspace/worktree is trusted by default. Crossing the workspace boundary requires explicit permission.**

Factory should feel powerful by default. Users should be able to clone or select a repository, start a workflow, let agents modify code, install project dependencies, run local development tooling, run tests, run Docker/DDEV, and create local commits without repeated permission prompts.

Factory must not become an approval-dialog generator.

---

# 2. Execution Profiles

Factory has two base execution profiles:

```text
Default
Full Access
```

Additional profiles may be created by users or organizations.

Custom profiles should normally inherit from `Default` and override only specific permissions.

```text
Default
   │
   ├── Custom: Restricted Network
   ├── Custom: Read-Only Database
   ├── Custom: CI Worker
   ├── Custom: No Containers
   └── Custom: Company Development

Full Access
```

`Full Access` is intentionally separate and should not normally be used as the inheritance base for custom profiles.

---

# 3. Default Profile

## 3.1 Purpose

`Default` is the standard Xaedalon Factory experience.

It should be:

- autonomous;
- productive;
- minimally interruptive;
- safe enough for ordinary development;
- usable without a long setup process.

The user should normally be able to install Factory, register a project, and start a workflow immediately.

The default policy should assume:

> The active project workspace is the agent's development environment.

Within that environment, agents should be given enough authority to perform ordinary software development.

---

# 4. Workspace Boundary

The active Factory workspace is the primary security boundary.

A workspace may be the selected repository itself, or preferably a dedicated worktree created for a task.

Example:

```text
/home/alex/projects/my-project/.factory/worktrees/WW2-1234
```

Everything under the canonical active workspace root is considered the task workspace.

Factory must resolve real/canonical paths before authorizing filesystem operations. Symlinks, bind mounts, junctions, `../`, or similar mechanisms must not silently allow workspace escape.

---

# 5. Default Profile — Automatically Allowed

Inside the active workspace/worktree, ordinary development operations should be allowed without user approval.

## Filesystem

Agents may automatically:

```text
read files
create files
edit files
rename files
move files
delete project files
create project directories
modify configuration files
modify generated files
```

provided their effective paths remain inside the active workspace.

## Development tools

The Default profile should assume that ordinary project tooling is intentionally available to the agent.

Examples:

```text
node / npm / npx / pnpm / yarn / bun
php / composer / drush
python / pip / pipx / poetry
ruby / bundle
go / cargo
git
ddev
docker / docker compose
make / cmake
eslint / prettier
vitest / jest / playwright / phpunit
project-specific scripts
```

Factory should not require explicit approval every time one of these tools is invoked when used for the active project.

---

# 6. Dependency Installation

Inside the workspace or project-scoped development environment, agents may automatically install or update project dependencies.

Examples:

```bash
npm install
npm ci
npm install <package>
composer install
composer require <package>
pip install -r requirements.txt
bundle install
cargo build
```

System-wide installation crosses the normal workspace boundary and should require explicit authorization.

Examples:

```bash
sudo apt install ...
brew install ...
apt install ...
dnf install ...
pacman -S ...
npm install -g ...
```

If Factory provides an isolated disposable container/environment where such changes are project-scoped, those operations may be treated as workspace-local.

---

# 7. Containers and DDEV

Default should support normal local container development without constant approval.

Agents may automatically perform project-scoped operations such as:

```text
ddev start
ddev stop
ddev restart
ddev exec
ddev composer
ddev npm

docker compose up
docker compose down
docker compose build
docker compose run
docker compose exec
docker compose logs
```

when they target the active project.

Operations affecting unrelated or global containers require permission.

Examples:

```text
docker stop <unrelated-container>
docker rm <unrelated-container>
docker system prune
docker volume prune
docker network prune
```

Factory should attempt to identify the active Compose/DDEV project before authorizing destructive container operations.

---

# 8. Shell Execution

Default should allow arbitrary shell commands when their effects remain inside the workspace or project-scoped development environment.

The system should avoid relying only on command-name blacklists.

Enforcement should primarily use:

- filesystem boundaries;
- working-directory boundaries;
- process isolation;
- environment filtering;
- resource policy;
- container/worktree isolation;
- network policy where available.

This allows agents to remain useful even when they invoke development tools Factory has never seen before.

---

# 9. Git Policy

Git is central to the Default profile.

## Automatically allowed

Agents may perform local repository operations such as:

```text
git status
git diff
git log
git show
git branch
git switch
git checkout
git add
git restore within workspace
git commit
git stash
git merge local branches
git rebase local branches
```

provided the operation remains local to the task workspace/repository.

Creating local commits is encouraged because commits are useful recovery points.

## Permission required

The following cross the local boundary:

```text
git push
git push --force
git push --force-with-lease
push tags
delete remote branch
rewrite remote history
merge remote pull request
publish release
```

These should require permission unless a custom profile or persistent project permission explicitly allows them.

Example:

```yaml
git:
  local: allow
  push: ask
  force_push: deny
  merge_remote: ask
```

---

# 10. Network Policy

Default should permit the network access needed for normal development without requiring extensive initial setup.

A practical initial mode is:

```text
network:
  mode: development
```

Development mode may automatically allow:

- repository hosts associated with the project;
- package registries;
- dependency mirrors;
- documentation sites;
- localhost;
- project development services;
- user-configured MCP endpoints;
- known development APIs explicitly registered with Factory.

Examples:

```text
github.com
api.github.com
bitbucket.org
gitlab.com
registry.npmjs.org
packagist.org
pypi.org
localhost
127.0.0.1
project containers
```

Factory should distinguish network access from external side effects.

Fetching documentation is different from deploying production code.

---

# 11. External Actions

Actions that affect systems outside the local development workspace should be treated as boundary crossings.

Examples include:

```text
git push
create pull request
merge pull request
post Jira comment
modify Jira status
send email
send Slack/Teams message
deploy
publish package
modify cloud infrastructure
modify remote database
delete remote resource
change DNS
create production release
```

Under Default:

```text
READ external resource       usually allowed when configured
WRITE external resource      permission required
DESTRUCTIVE external action  permission required or denied
```

Examples:

```text
Jira read issue      → allow
Jira add comment     → ask
Jira close issue     → ask

GitHub read PR       → allow
GitHub create PR     → ask
GitHub merge PR      → ask
```

Users may create persistent project permissions later.

---

# 12. Secrets and Credentials

The Default profile must not blindly inherit every credential available to the user's login shell.

Factory should filter the execution environment.

Sensitive resources should not be automatically exposed unless explicitly configured.

Examples:

```text
~/.ssh
~/.aws
~/.gnupg
~/.kube
browser profiles
system keychains
cloud credentials
password stores
unrelated .env files
```

Project-local credentials intentionally placed inside the workspace are accessible to the project unless Factory provides stronger secret handling.

Long term, credentials should become explicit Factory resources.

Example:

```yaml
resources:
  github:
    permissions:
      - read_repository

  jira:
    permissions:
      - read_issue
```

---

# 13. Environment Variables

Factory should construct a controlled execution environment rather than blindly forwarding the complete parent environment.

Potential categories:

```text
SAFE_DEVELOPMENT
PROJECT
SECRET
SYSTEM
BLOCKED
```

Ordinary values such as `PATH`, locale settings, terminal configuration, and project configuration may be passed as appropriate.

Potential secrets such as the following should be filtered unless explicitly authorized:

```text
AWS_SECRET_ACCESS_KEY
GITHUB_TOKEN
NPM_TOKEN
DATABASE_URL
PRODUCTION_API_KEY
```

---

# 14. Database Access

Project-local databases may be used automatically.

Examples:

```text
DDEV database
Docker Compose database
SQLite inside project
local development PostgreSQL
local development MySQL
```

Remote databases should require explicit resource configuration.

Production databases must never be assumed safe under Default.

Suggested policy:

```yaml
database:
  local:
    read: allow
    write: allow

  remote-development:
    read: allow
    write: ask

  production:
    read: ask
    write: deny
```

---

# 15. Process Safety

Factory should track all child processes launched for a workflow.

A run should have a process group or equivalent containment mechanism so Factory can terminate:

```text
agent process
subagents
shell commands
test runners
child processes
background processes
```

associated with that run.

---

# 16. Kill Switch

Factory must provide a prominent emergency control:

```text
STOP ALL AGENTS
```

This must terminate actual child process trees, not merely send a cooperative message to the AI agent.

CLI equivalents:

```bash
factory stop --all
factory run stop <RUN_ID>
```

---

# 17. Execution Limits

Default should include reasonable automatic limits to prevent runaway workflows without being intrusive.

Suggested starting values:

```yaml
limits:
  max_parallel_agents: 3
  max_single_agent_runtime: 60m
  max_workflow_runtime: 4h
  max_retries_per_step: 3
  max_consecutive_failures: 5
```

Where providers expose reliable cost information, Factory may support:

```yaml
limits:
  max_estimated_cost_per_run: 20
```

When a limit is reached:

```text
pause
notify user
require explicit continuation
```

---

# 18. Recovery and Checkpoints

Factory should make autonomous execution recoverable.

Whenever practical, create checkpoints around meaningful workflow transitions.

Git should be the primary mechanism.

Example:

```text
Initial state
    ↓
Implementation commit
    ↓
Tests
    ↓
Review commit
```

The UI should expose:

```text
View changes
View commits
Restore initial state
Reset task workspace
Discard worktree
```

---

# 19. Worktree-First Execution

When possible, workflows that modify code should execute in dedicated Git worktrees.

Example:

```text
main repository
     │
     └── Factory task
            │
            ▼
      task worktree
            │
            ▼
      autonomous agent
```

Benefits:

- isolation;
- parallel tasks;
- easy cleanup;
- recovery;
- safer experimentation;
- clear diffs;
- reduced interference with developer work.

If a repository cannot use worktrees, Factory may run against the selected workspace directly but should clearly indicate this.

---

# 20. Default Profile UX

Users should not be forced through a large permission wizard during onboarding.

Initial setup should be approximately:

```text
Select repository
Connect/select AI provider
Start workflow
```

Suggested first-run explanation:

> Factory agents can autonomously modify and run development tools inside the active project workspace. Actions outside the workspace or affecting external systems require your permission.

Then:

```text
[Continue with Default]
[Review permissions]
```

Most users should simply continue with Default.

---

# 21. Boundary Permission UX

When a workflow requests authority outside Default, Factory should explain the effect.

Example:

```text
Agent requests permission

Action:
Push branch feature/WW2-1234 to origin

Reason:
Workflow has completed tests and wants to publish the branch.

Scope:
github.com/example/project

[Allow Once]
[Allow for this Project]
[Deny]
```

Permission dialogs must describe the action, not provider-specific implementation flags.

Avoid:

```text
Allow --dangerously-skip-permissions?
```

Prefer:

```text
Allow agent to push branches to this repository?
```

---

# 22. Persistent Permissions

Permission decisions may have scopes such as:

```text
once
current run
current workflow
current project
all projects
```

Example:

```text
Allow git push:
  [Once]
  [For this project]
  [Always]
```

Destructive permissions should not offer overly broad persistent grants unless explicitly enabled.

---

# 23. Full Access Profile

## Purpose

`Full Access` provides the highest possible autonomy and authority.

It is intended for:

- disposable VMs;
- isolated development machines;
- trusted local environments;
- experienced users who intentionally want unrestricted execution;
- CI workers designed for unrestricted agent activity.

It must not be the default.

## Behavior

Under Full Access, Factory may allow agents to inherit the permissions of the Factory host process/user.

This may include:

```text
filesystem outside workspace
unrestricted shell
network access
credentials available to the process
system tools
external services
git push
package publishing
infrastructure tools
```

Factory should still preserve:

- run logging;
- process tracking;
- kill switch;
- execution history;
- configured limits.

Full Access removes normal permission boundaries, not observability.

---

# 24. Full Access Warning

The user must explicitly opt in.

Recommended warning:

> ## Full Access
>
> Factory will allow agents to execute commands with the permissions available to your operating-system user.
>
> Agents may access files outside the project, use credentials available to the environment, modify external systems, or perform irreversible actions.
>
> Use Full Access only in environments you trust and can restore.

Require explicit confirmation.

Example:

```text
[ ] I understand that agents may execute arbitrary commands.
[ ] I understand that actions outside the project may be irreversible.

[Enable Full Access]
```

---

# 25. Full Access Visibility

Factory should make Full Access obvious while active.

Example:

```text
Execution Profile: FULL ACCESS
```

Show a prominent indicator in:

- project header;
- workflow execution view;
- run details;
- history.

A user should never forget that a project is running unrestricted.

---

# 26. Custom Profiles

Users and organizations may create additional profiles.

Custom profiles should normally inherit from `Default`.

Example:

```yaml
name: company-development
extends: default

filesystem:
  outside_workspace: deny

network:
  mode: allowlist
  allow:
    - github.company.com
    - npm.company.com

git:
  push: allow
  force_push: deny

jira:
  read: allow
  write: allow

production:
  access: deny
```

Inheritance keeps configuration simple: users change only what differs from Default.

---

# 27. Profile Inheritance

Recommended model:

```yaml
profile:
  name: my-profile
  extends: default
```

Each property should support states such as:

```text
inherit
allow
ask
deny
```

Potential later state:

```text
allow_with_notification
```

Example:

```yaml
git:
  push: ask
  force_push: deny
```

---

# 28. Illustrative Default Policy Schema

The exact schema may change, but Factory should be able to express equivalent behavior.

```yaml
profile:
  name: default

workspace:
  read: allow
  write: allow
  delete: allow

filesystem:
  outside_workspace:
    read: ask
    write: ask
    delete: deny

shell:
  workspace: allow
  outside_workspace: ask

development_tools:
  workspace: allow

dependencies:
  project: allow
  system: ask

containers:
  project: allow
  unrelated: ask
  prune_global: deny

git:
  local: allow
  push: ask
  force_push: deny
  remote_delete: ask

network:
  development: allow
  arbitrary_external: ask

external_actions:
  read: allow
  write: ask
  destructive: ask

secrets:
  project: inherit
  user_global: deny

production:
  access: deny
```

---

# 29. Provider Abstraction

Provider-specific autonomy flags must remain implementation details.

Factory users should interact with Factory execution policies.

Example:

```text
Factory Default
       │
       ├── Claude Code adapter
       │      └── configures autonomous provider mode
       │
       ├── Copilot adapter
       │      └── configures autopilot
       │
       ├── Codex adapter
       │      └── configures non-interactive execution
       │
       └── Generic CLI adapter
```

Do not expose the product as a permission-bypass manager.

Factory owns the execution-policy abstraction.

---

# 30. Defense in Depth

Factory must not depend exclusively on provider-level permission prompts.

Security layers may include:

```text
Factory policy
    +
workspace boundary
    +
worktree
    +
filesystem sandbox
    +
environment filtering
    +
network controls
    +
provider safeguards
    +
logging
```

No single mechanism should be assumed perfect.

---

# 31. Additional Workspace Resources

A project may intentionally expose additional directories or repositories.

Example:

```yaml
workspace:
  root: /projects/app

additional_paths:
  - path: /projects/shared-library
    access: read-write

  - path: /datasets/test-data
    access: read
```

Once explicitly configured, these resources become part of the effective workspace boundary.

This avoids repeated approval requests for legitimate multi-repository development.

---

# 32. Multiple Repositories

Factory should support projects that legitimately use several repositories.

Example:

```text
frontend
backend
shared-sdk
```

Users may define several workspace roots:

```yaml
workspace:
  roots:
    - ~/projects/frontend
    - ~/projects/backend
    - ~/projects/shared-sdk
```

All declared roots inherit normal Default workspace behavior.

---

# 33. MCP and Tool Resources

MCP servers and similar capabilities should be explicit Factory resources.

Example:

```yaml
resources:
  jira:
    type: mcp
    permissions:
      read: allow
      write: ask

  mysql-development:
    type: mcp
    permissions:
      read: allow
      write: allow
```

Factory should classify resources when possible:

```text
local
development
staging
production
unknown
```

---

# 34. Notifications

Default should not notify users for every successful action.

Notify primarily when:

```text
permission required
workflow blocked
workflow failed
workflow completed
execution limit reached
Full Access enabled
boundary violation detected
```

Do not notify for routine actions such as:

```text
file changed
test command started
npm install completed
local commit created
```

unless verbose notifications are enabled.

---

# 35. Audit and Run History

Every run should record enough information to understand what occurred.

Recommended data:

```text
run ID
task ID
execution profile
provider
workspace
start/end time
commands executed
files changed summary
local commits
permission requests
permission decisions
external actions
limits reached
completion status
```

Community/Pro may keep this locally.

Future Team/Enterprise products may aggregate policy-safe metadata.

---

# 36. Permission Events

Permission events should be explicit domain events.

Examples:

```text
permission.requested
permission.allowed_once
permission.allowed_project
permission.denied
boundary.violation
full_access.enabled
full_access.disabled
```

This enables future UI, Team policy, and Enterprise audit features.

---

# 37. Boundary Violations

If an agent attempts an operation that violates the active policy:

1. block the operation;
2. record the event;
3. pause the relevant step if permission may be granted;
4. explain the requested effect;
5. allow the user to approve or deny when appropriate.

Do not terminate the entire workflow for every recoverable boundary request.

---

# 38. Destructive Operations

Some operations deserve stronger handling even if initiated inside the workspace.

Examples:

```text
rm -rf workspace root
delete entire repository
wipe database
drop all tables
delete all Docker volumes
reset repository beyond recovery
```

Factory should consider:

- automatic checkpoint first;
- confirmation;
- denial depending on context.

The product should distinguish normal project file deletion from catastrophic workspace destruction.

---

# 39. Production Awareness

Resources may be labeled:

```text
local
development
staging
production
unknown
```

Under Default:

```text
local        → normal project permissions
development  → normal project permissions
staging      → ask for writes
production   → deny or strongly gate
unknown      → conservative behavior
```

---

# 40. First-Run Experience

Suggested onboarding:

```text
Welcome to Xaedalon Factory

Factory agents can autonomously modify code and run
development tools inside the selected project workspace.

Anything outside that workspace requires permission.

Execution profile:
● Default — Recommended
○ Full Access

[Continue]
```

No long security wizard should be required.

Advanced users may choose:

```text
Review profile settings
```

---

# 41. Project Onboarding

Example:

```text
Repository: ~/projects/example

Execution profile:
Default

Workspace access:
✓ Entire repository

Development tools detected:
✓ Git
✓ Node
✓ npm
✓ Docker
✓ DDEV

External resources:
GitHub origin detected
Push requires approval.

[Add Project]
```

This communicates boundaries without forcing unnecessary setup.

---

# 42. Workflow UX

Before running a workflow, Factory may display a compact policy summary:

```text
Workflow: Implement Ticket

Profile: Default

Workspace          Full access
Local tools        Allowed
Containers         Project containers allowed
Git local          Allowed
Git push           Approval required
External writes    Approval required

[Run]
```

Do not require confirmation every time unless the user has chosen that preference.

---

# 43. Full Access Workflow UX

If Full Access is active:

```text
Workflow: Implement Ticket

Profile: FULL ACCESS

⚠ Agents may operate outside the project and use
  permissions available to your local user.

[Run with Full Access]
```

Keep it visually distinct.

---

# 44. Security Documentation

Public documentation should include:

```text
/docs/proposals/execution-profiles.md
/docs/security/default-profile.md
/docs/security/full-access.md
/docs/security/workspace-boundary.md
/docs/security/credentials.md
```

The README should summarize:

> Factory is autonomous inside your project workspace by default. Actions outside the project or affecting external systems require permission unless Full Access is explicitly enabled.

---

# 45. README Warning

Recommended concise wording:

> **Security:** Xaedalon Factory coordinates autonomous coding agents that can modify files and execute development commands. The Default profile gives agents broad authority inside the active project workspace while requiring permission for actions outside that boundary. Full Access removes these restrictions and should only be used in trusted or disposable environments.

Do not lead the README with scary warnings. Security should be clear without obscuring the value proposition.

---

# 46. Provider Documentation

Each provider adapter should document:

```text
how autonomy is enabled
what provider-level safeguards remain active
what Factory boundaries apply
known limitations
whether the provider can escape or bypass certain controls
```

Never imply stronger isolation than the implementation actually provides.

---

# 47. Implementation Priority

## Phase 1 — Current-State Audit

Before modifying Factory, produce:

```text
docs/security/current-execution-model.md
```

Document:

- how Claude is launched;
- how Copilot is launched;
- how Codex is launched;
- provider permission bypass flags;
- current shell execution path;
- current process ownership;
- current workspace handling;
- whether worktrees are already used;
- environment variables inherited;
- credential exposure;
- Docker/DDEV access;
- git remote operations;
- current kill/cancel behavior;
- current external integrations;
- current approval model;
- known security gaps.

Classify current behavior as:

```text
SAFE_DEFAULT
DEFAULT_REQUIRES_CONTROL
FULL_ACCESS_ONLY
UNKNOWN
```

Do not begin major refactors until this analysis exists.

## Phase 2 — Policy Model

Create or formalize:

```text
ExecutionProfile
Permission
Resource
Boundary
PermissionDecision
```

Implement the two base profiles:

```text
Default
Full Access
```

Do not build a complex profile editor yet.

## Phase 3 — Workspace Boundary

Enforce:

```text
workspace roots
canonical path checks
outside-workspace detection
symlink/path escape handling
```

## Phase 4 — Run/Process Control

Implement:

```text
process tracking
run cancellation
stop all
```

## Phase 5 — External Actions

Introduce permission gates for:

```text
git push
remote writes
registered integrations
production resources
```

## Phase 6 — Environment and Secrets

Reduce uncontrolled environment inheritance.

## Phase 7 — Custom Profiles

Add:

```text
extends: default
granular overrides
persistent permissions
```

## Phase 8 — Stronger Isolation

Improve:

```text
sandboxing
network controls
container isolation
resource scopes
```

Do not block initial release waiting for perfect sandboxing if limitations are documented accurately.

---

# 48. Required First Implementation Milestone

The first milestone is complete when:

- `Default` and `Full Access` profiles exist;
- Default is selected automatically for new projects;
- active workspace/worktree is identified;
- workspace-local development remains autonomous;
- outside-workspace operations can be detected;
- permission requests exist for boundary crossings;
- Full Access requires explicit opt-in;
- active Full Access state is visible;
- Factory can terminate agent process trees;
- execution profile is recorded in run history;
- provider adapters map Factory profiles to provider execution modes;
- provider-specific dangerous flags are not the primary user-facing permission model.

---

# 49. Definition of Done — Default

A developer using Default should be able to give Factory a normal repository and successfully run a development workflow without unnecessary interruptions.

The agent should be able to:

```text
inspect repository
edit files
delete/create project files
install project dependencies
run npm/composer/etc.
run tests
run project Docker/DDEV commands
iterate autonomously
create local commits
```

without asking permission.

The agent should require permission before:

```text
accessing unrelated filesystem locations
using unapproved global credentials
performing external writes
pushing to remote repositories
modifying unrelated containers
performing system-level changes
touching production resources
```

This balance is the desired Xaedalon Factory experience.

---

# 50. Definition of Done — Full Access

A developer may explicitly enable Full Access and allow Factory to operate with the authority available to the local host/user.

Factory must still provide:

```text
observability
run history
process control
kill switch
workflow limits
clear Full Access indicator
```

Full Access should feel powerful and intentional, never accidental.

---

# 51. Future Team and Enterprise Direction

The same policy system should eventually support organization-controlled execution.

Example future Team policy:

```yaml
extends: default

git:
  push: allow
  force_push: deny

production:
  access: deny

full_access:
  developer_can_enable: false
```

Enterprise may add:

```text
centrally enforced profiles
SSO-based roles
immutable organization policy
audit retention
secret providers
remote policy distribution
air-gapped execution
```

The Community/Pro policy architecture should avoid assumptions that all policies are user-editable forever.

---

# 52. Product Positioning

Execution safety can become a core Xaedalon Factory differentiator.

Do not market Factory as:

> a tool that bypasses permissions so agents can do anything.

Instead:

> **Autonomous where developers need speed. Controlled where authority matters.**

Or:

> **Autonomous inside the workspace. Permissioned beyond it.**

The desired user perception is:

```text
"I gave AI a controlled development workspace."
```

not:

```text
"I gave AI my entire computer."
```

---

# 53. Final Architecture Principle

Every future execution feature should be evaluated using these questions:

1. Does this reduce unnecessary interruption for normal development inside the active project?
2. Does this grant authority beyond what is necessary for the active project?

If it increases useful autonomy without unnecessary authority, it belongs in Default.

If it requires broad host/user authority, it belongs behind explicit permission or Full Access.

The long-term target is:

> **High autonomy. Constrained authority. Minimal friction. Clear boundaries.**
