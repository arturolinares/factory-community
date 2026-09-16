import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * Is this path inside the workspace?
 *
 * The workspace is the security boundary the whole `default` profile rests on,
 * and before this the codebase contained exactly one containment check — for
 * static assets (`apps/daemon/src/routes/web.ts`). Nothing canonicalised a
 * workspace, a worktree or a step's working directory, and two paths got in
 * through the gap: a phase's `working_dir`, which `joinPath` lets restart the
 * path entirely when it is absolute, and `task.directory`, which arrived from a
 * client and became the agent's own directory.
 *
 * Lexical comparison alone is not enough. `/repos/app/..` is inside `/repos`
 * only until you resolve it, and a symlink inside the workspace pointing at
 * `/etc` is outside it however the string reads. So both sides are made
 * canonical first, and `realpath` is the only thing that answers the symlink.
 *
 * `canonical` is a parameter for the reason `workspaceFor` takes `exists` and
 * `joinPath` exists at all: the rule is then exercisable without a filesystem,
 * and the one implementation that needs `node:fs` is named and separate, the
 * way `systemDetachedLauncher` is in `tools.ts`.
 */
export type Canonicalise = (path: string) => string

/**
 * `/` rather than `node:path`'s `sep`.
 *
 * The same choice `joinPath` already made, and for the same reason: every path
 * this module compares was built by `joinPath` or by a shell script the
 * worktree step kind emits, and both are POSIX. A Windows port changes one
 * constant here and one there, rather than discovering the assumption in a
 * boundary check that quietly passed everything.
 */
const SEPARATOR = '/'

const trimEnd = (path: string): string =>
  path.length > 1 && path.endsWith(SEPARATOR) ? path.replace(/\/+$/, '') : path

/**
 * Whether `candidate` is the workspace or something under it.
 *
 * The workspace itself counts — a step running in the project root is the
 * ordinary case, not an escape.
 *
 * A sibling whose name merely starts the same way does **not** count, which is
 * why the test appends the separator rather than using a bare `startsWith`:
 * `/repos/todolist` is not inside `/repos/todo`.
 */
export function withinWorkspace(
  candidate: string,
  workspace: string,
  canonical: Canonicalise,
): boolean {
  const inside = trimEnd(canonical(candidate))
  const root = trimEnd(canonical(workspace))
  return inside === root || inside.startsWith(root + SEPARATOR)
}

/**
 * Why a path was refused, in the one wording.
 *
 * A sentence rather than a code, because this reaches a person in three places
 * — a refused run's detail, a doctor warning and the board — and a reader who
 * has to look up what `boundary.escape` means is a reader who will guess.
 */
export function outsideWorkspaceMessage(
  what: string,
  candidate: string,
  workspace: string,
): string {
  return (
    `${what} resolves to ${candidate}, which is outside this task's workspace ` +
    `(${workspace}). The Default profile keeps a run inside its workspace; the ` +
    `Full Access profile allows this.`
  )
}

/**
 * The real answer, for callers that have a filesystem.
 *
 * A step's working directory is frequently a worktree that a *later* phase
 * creates, so this has to answer for paths that are not there yet — refusing a
 * plan because a directory does not exist would break the worktree-first
 * workflow the profile is built around.
 *
 * So it resolves the **deepest ancestor that does exist** and re-appends the
 * rest, rather than falling back to a lexical `resolve` for the whole path.
 * Falling back was the first implementation and it was wrong in a way that only
 * a real filesystem shows: on macOS a temporary directory lives under a
 * symlinked `/var`, so the workspace canonicalised to `/private/var/…` while a
 * not-yet-created directory inside it stayed `/var/…` — and the check called
 * its own workspace an escape. Any user whose repository is reached through a
 * symlink would have hit the same thing.
 *
 * The remaining limit is real and not hidden: a path that does not exist cannot
 * be checked for links, so a directory created *during* a run as a link out of
 * the workspace is not caught here. That one is caught by the provider's own
 * confinement (`--restricted`, `--add-dir`), which is why the profile is
 * layered rather than resting on this function alone.
 */
export const systemCanonical: Canonicalise = (path) => {
  const absolute = resolve(path)
  let head = absolute
  const missing: string[] = []
  for (;;) {
    try {
      const real = realpathSync(head)
      return missing.length === 0 ? real : join(real, ...missing)
    } catch {
      const parent = dirname(head)
      // Reached the root and nothing along the way exists. Lexical is all there
      // is, and it is still absolute and normalised.
      if (parent === head) return absolute
      missing.unshift(basename(head))
      head = parent
    }
  }
}
