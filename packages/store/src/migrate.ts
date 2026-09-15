import type { Database } from './sqlite.js'

/**
 * Versioned migrations.
 *
 * The prototype had fourteen `ALTER TABLE`s in a try/catch with the errors
 * swallowed and no version recorded anywhere, so there was no way to answer
 * "what shape is this database in?" — only to run them all again and hope. A
 * migration that cannot be reasoned about is worse than a schema change nobody
 * made.
 *
 * So: an ordered list, a version stamped in the file itself, and each migration
 * applied inside a transaction. A database is either fully at a version or
 * unchanged; there is no halfway.
 */

export interface Migration {
  /** Sequential from 1, with no gaps. Checked, because a gap means a lost file. */
  readonly version: number
  /** What it does, shown by `factory doctor` and in the migration log. */
  readonly describe: string
  up(db: Database): void
}

export interface MigrationOutcome {
  readonly from: number
  readonly to: number
  readonly applied: readonly { version: number; describe: string }[]
}

export function currentVersion(db: Database): number {
  const row = db.get<{ user_version: number }>('PRAGMA user_version')
  return row?.user_version ?? 0
}

/**
 * Bring a database up to the latest migration.
 *
 * Refuses to touch a database newer than the code, because an older Factory
 * cannot know what a newer one added — and guessing would corrupt it. Telling
 * someone to upgrade is the only honest answer.
 */
export function migrate(db: Database, migrations: readonly Migration[]): MigrationOutcome {
  assertWellFormed(migrations)

  const from = currentVersion(db)
  const latest = migrations.at(-1)?.version ?? 0

  if (from > latest) {
    throw new Error(
      `This database is at version ${from}, but this build only knows up to ${latest}. ` +
        `It was written by a newer Factory — upgrade rather than running this one against it.`,
    )
  }

  const applied: { version: number; describe: string }[] = []
  for (const migration of migrations) {
    if (migration.version <= from) continue
    // Each migration is its own transaction: a failure leaves the database at
    // the last version that fully applied, which is a state someone can act on.
    db.transaction(() => {
      migration.up(db)
      // PRAGMA will not take a bound parameter, and the value is a validated
      // integer from our own list rather than anything a caller supplied.
      db.exec(`PRAGMA user_version = ${migration.version}`)
    })
    applied.push({ version: migration.version, describe: migration.describe })
  }

  return { from, to: currentVersion(db), applied }
}

function assertWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expected = index + 1
    if (migration.version !== expected) {
      // A gap or a duplicate almost always means a file was lost in a merge, and
      // silently skipping it would leave two databases claiming the same version
      // with different schemas.
      throw new Error(
        `Migration ${migration.version} ("${migration.describe}") is out of sequence — ` +
          `expected ${expected}. Migrations must be numbered from 1 with no gaps.`,
      )
    }
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Migration version must be a positive integer, got ${migration.version}.`)
    }
  })
}
