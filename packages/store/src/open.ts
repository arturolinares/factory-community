import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrate, type Migration, type MigrationOutcome } from './migrate.js'
import { openDatabase, type Database } from './sqlite.js'

/**
 * Opening the store for a scope.
 *
 * The path comes from the caller, never from the environment — the same rule
 * the scope resolver follows, and for the same reason: the prototype's database
 * path was a module-level constant computed from a `__dirname` climb, so the
 * environment variable meant to redirect it in tests was read before anything
 * could set it.
 */
export interface Store {
  readonly db: Database
  readonly migration: MigrationOutcome
  close(): void
}

/** Where a scope keeps its database. */
export const storePath = (scopeRoot: string): string => join(scopeRoot, 'state', 'factory.db')

export function openStore(options: {
  /** Absolute path to the database file. `:memory:` for a throwaway one. */
  file: string
  migrations: readonly Migration[]
}): Store {
  if (options.file !== ':memory:') mkdirSync(dirname(options.file), { recursive: true })

  const db = openDatabase(options.file)
  try {
    const migration = migrate(db, options.migrations)
    return { db, migration, close: () => db.close() }
  } catch (error) {
    // A failed migration must not leave a handle open: on Windows an open
    // handle stops the file being replaced, and a half-open store is harder to
    // diagnose than a closed one.
    db.close()
    throw error
  }
}
