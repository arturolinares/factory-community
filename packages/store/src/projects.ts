import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { defaultWorktreesRoot, type Project } from '@factory/core'
import type { EventBus } from '@factory/events'
import type { Database } from './sqlite.js'

/**
 * Projects, on disk.
 *
 * The path is checked here, on the way in, rather than when something tries to
 * run there. A project pointing at a directory that does not exist is a mistake
 * someone can fix in two seconds at the moment they make it, and a mystery half
 * an hour into a run.
 */

interface ProjectRow {
  id: string
  name: string
  path: string
  default_branch: string
  worktrees_root: string
  is_repository: number
  uses_worktrees: number
  uses_environments: number
  created_at: string
}

export interface AddProject {
  readonly name: string
  readonly path: string
  readonly defaultBranch?: string
  readonly worktreesRoot?: string
  /** Defaults to whether the directory is a git repository. */
  readonly usesWorktrees?: boolean
  /** Defaults to off: Factory cannot build an environment unaided. */
  readonly usesEnvironments?: boolean
}

export interface ProjectRepositoryOptions {
  readonly db: Database
  readonly events?: EventBus
  readonly now?: () => string
  readonly newId?: () => string
}

export class ProjectRepository {
  readonly #db: Database
  readonly #events: EventBus | undefined
  readonly #now: () => string
  readonly #newId: () => string

  constructor(options: ProjectRepositoryOptions) {
    this.#db = options.db
    this.#events = options.events
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#newId = options.newId ?? (() => randomUUID())
  }

  add(input: AddProject): Project {
    const name = input.name.trim()
    if (name === '') throw new Error('A project needs a name.')

    // Resolved rather than required-absolute: a caller passing a relative path
    // means it relative to its own working directory, and it is the only one
    // that knows what that is — so it resolves before calling. Anything still
    // relative here is a bug worth naming.
    if (!isAbsolute(input.path)) {
      throw new Error(`The path for "${name}" must be absolute; got "${input.path}".`)
    }
    const path = resolve(input.path)

    if (!existsSync(path)) {
      throw new Error(`Cannot add "${name}": there is nothing at ${path}.`)
    }
    if (!statSync(path).isDirectory()) {
      throw new Error(`Cannot add "${name}": ${path} is not a directory.`)
    }
    if (this.byName(name) !== undefined) {
      throw new Error(`There is already a project called "${name}".`)
    }

    const id = this.#newId()
    // A worktree needs a repository; a directory without one is still a fine
    // place to run shell steps, so this is recorded rather than refused.
    const isRepository = existsSync(join(path, '.git'))
    const usesWorktrees = input.usesWorktrees ?? isRepository

    // Refused rather than quietly corrected, for the same reason the path is
    // checked here: a mistake someone can fix in two seconds now is a mystery
    // half an hour into a run.
    if (usesWorktrees && !isRepository) {
      throw new Error(
        `Cannot give "${name}" a worktree for each task: ${path} is not a git repository. ` +
          `Leave worktrees off and its work will happen in that directory, one task at a time.`,
      )
    }

    this.#db.run(
      `INSERT INTO projects (id, name, path, default_branch, worktrees_root, is_repository,
                             uses_worktrees, uses_environments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      name,
      path,
      input.defaultBranch ?? 'main',
      input.worktreesRoot ?? defaultWorktreesRoot(path, name, join),
      isRepository ? 1 : 0,
      usesWorktrees ? 1 : 0,
      input.usesEnvironments === true ? 1 : 0,
      this.#now(),
    )
    const project = this.get(id) as Project
    this.#events?.emit('project.added', { projectId: id, name, path })
    return project
  }

  get(id: string): Project | undefined {
    const row = this.#db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
    return row === undefined ? undefined : hydrate(row)
  }

  byName(name: string): Project | undefined {
    const row = this.#db.get<ProjectRow>('SELECT * FROM projects WHERE name = ?', name)
    return row === undefined ? undefined : hydrate(row)
  }

  list(): Project[] {
    return this.#db.all<ProjectRow>('SELECT * FROM projects ORDER BY name').map(hydrate)
  }

  /**
   * Turn worktrees on or off for a project that already exists.
   *
   * Turning them *on* re-checks the disk rather than trusting `is_repository`:
   * that column is written once when the project is added and never refreshed,
   * so someone who ran `git init` afterwards could otherwise never turn them on.
   * The same UPDATE corrects the column, which also keeps the "not a git
   * repository" badge honest.
   *
   * Deliberately allowed while the project has work in flight. Tasks already
   * running finish where they are, and the new rule applies to what starts
   * next — a refusal nobody can discover is worse than a graceful change.
   */
  setWorktrees(id: string, usesWorktrees: boolean): Project {
    const project = this.get(id)
    if (project === undefined) throw new Error(`No project ${id}.`)

    const isRepository = existsSync(join(project.path, '.git'))
    if (usesWorktrees && !isRepository) {
      throw new Error(
        `Cannot give "${project.name}" a worktree for each task: ${project.path} is not a git ` +
          `repository.`,
      )
    }

    this.#db.run(
      'UPDATE projects SET uses_worktrees = ?, is_repository = ? WHERE id = ?',
      usesWorktrees ? 1 : 0,
      isRepository ? 1 : 0,
      id,
    )
    return this.#changed(id)
  }

  /**
   * Turn environments on or off.
   *
   * No repository check, unlike worktrees: an environment is whatever the
   * project's own workflows build, and there is nothing about a directory that
   * makes one impossible. Turning it on is a statement that this project has
   * environment workflows worth running, and the caller is expected to make
   * sure it has them.
   */
  setEnvironments(id: string, usesEnvironments: boolean): Project {
    if (this.get(id) === undefined) throw new Error(`No project ${id}.`)
    this.#db.run(
      'UPDATE projects SET uses_environments = ? WHERE id = ?',
      usesEnvironments ? 1 : 0,
      id,
    )
    return this.#changed(id)
  }

  /** Re-read and announce. Both setters end the same way. */
  #changed(id: string): Project {
    const updated = this.get(id) as Project
    this.#events?.emit('project.changed', {
      projectId: id,
      name: updated.name,
      usesWorktrees: updated.usesWorktrees,
      usesEnvironments: updated.usesEnvironments,
    })
    return updated
  }

  /**
   * Forget a project.
   *
   * Its tasks stay. Removing a project from Factory is bookkeeping — the work
   * that was done in it still happened, and deleting the record of it because
   * someone tidied a list would be a surprise nobody wants.
   */
  remove(id: string): boolean {
    const removed = this.#db.run('DELETE FROM projects WHERE id = ?', id).changes > 0
    if (removed) this.#events?.emit('project.removed', { projectId: id })
    return removed
  }
}

function hydrate(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    defaultBranch: row.default_branch,
    worktreesRoot: row.worktrees_root,
    isRepository: row.is_repository === 1,
    usesWorktrees: row.uses_worktrees === 1,
    usesEnvironments: row.uses_environments === 1,
    createdAt: row.created_at,
  }
}
