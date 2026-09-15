import type { Join } from './project.js'

/**
 * Where Xaedalon products put files that belong to the product, not the project.
 *
 * A repository is the user's. Anything a product writes into one has to be
 * findable, obviously not theirs, and easy to ignore in a single line — so it
 * all goes under one directory named for the family, with a directory per
 * product inside it. Factory is the first; the shape is meant for the others.
 *
 * ```
 * <repo>/.xaedalon/
 *   .gitignore                    ".factory/tasks/"
 *   .factory/
 *     workflows/ phases/ agents/  definitions, committed
 *     tasks/<task>/artifacts/     what runs produced, ignored
 * ```
 *
 * `join` is a parameter, the way `defaultWorktreesRoot` already takes one, so
 * core needs no import from `node:path`.
 */

/**
 * Join path parts, without importing `node:path`.
 *
 * Here rather than in each caller because there were two: `resolvePlan` had a
 * **binary** one while `Join` is variadic, so `artifactFile(root, name, file)`
 * silently dropped the filename — the prompt named `analysis/analysis.md` and
 * the collector looked at `analysis/`. Two implementations of one idea, and the
 * one that was wrong was the one nobody was reading.
 *
 * An absolute part starts again, the way `path.join` does not but every caller
 * here expects.
 */
export const joinPath: Join = (...parts: string[]): string =>
  parts.reduce((base, part) =>
    part.startsWith('/') ? part : `${base.replace(/\/+$/, '')}/${part}`,
  )

/** The family's directory inside a repository. */
export const PRODUCT_FAMILY_DIR = '.xaedalon'

/** Factory's directory inside it. */
export const PRODUCT_DIR = '.factory'

/** What a repository should ignore: everything a run produces, and nothing else. */
export const IGNORED_BY_PRODUCT = `${PRODUCT_DIR}/tasks/`

export const familyRoot = (projectPath: string, join: Join): string =>
  join(projectPath, PRODUCT_FAMILY_DIR)

export const productRoot = (projectPath: string, join: Join): string =>
  join(familyRoot(projectPath, join), PRODUCT_DIR)

/**
 * Everything one task produced.
 *
 * Keyed by the task's directory — the slug frozen when the task was created —
 * which is also what its worktree is called, so the two read as the same task.
 */
export const taskRoot = (projectPath: string, taskDirectory: string, join: Join): string =>
  join(productRoot(projectPath, join), 'tasks', taskDirectory)

/**
 * Where a task's artifacts live.
 *
 * Under the project, never under the worktree. A worktree is deleted when the
 * work in it ends, and an artifact that disappears with the work it describes
 * is no better than no artifact.
 */
export const artifactsRoot = (projectPath: string, taskDirectory: string, join: Join): string =>
  join(taskRoot(projectPath, taskDirectory, join), 'artifacts')

/** The current version of one artifact. Always Markdown, so the name is enough. */
export const artifactFile = (artifacts: string, name: string, join: Join): string =>
  join(artifacts, name, `${name}.md`)

/** Where the copies of every run of it are kept. */
export const artifactVersions = (artifacts: string, name: string, join: Join): string =>
  join(artifacts, name, 'versions')

/** One of those copies. */
export const artifactVersion = (
  artifacts: string,
  name: string,
  stamp: string,
  join: Join,
): string => join(artifactVersions(artifacts, name, join), `${name}-${stamp}.md`)

/**
 * A timestamp that is safe in a filename.
 *
 * The same shape the bundle importer already uses for its dated backup
 * directory: ISO-8601 with the characters a filesystem dislikes replaced. Taken
 * as a `Date` so a caller can pass its own clock and a test can be deterministic.
 */
export const fileStamp = (at: Date): string => at.toISOString().replaceAll(/[:.]/g, '-')
