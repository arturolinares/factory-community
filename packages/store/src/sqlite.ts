/**
 * The only module that knows which SQLite binding Factory uses.
 *
 * `node:sqlite` rather than a native package, because a native build means
 * someone can clone Factory and fail to install it at all — a worse failure
 * than an experimental API. It is experimental, so it is wrapped: everything
 * above this file sees the narrow interface below, and replacing the binding is
 * one file's work.
 */

// Patched before the import, because node:sqlite emits its experimental warning
// at load time and Node's default printer cannot be removed by adding a
// listener. A tool people run dozens of times a day should not print a notice
// about its own internals on every invocation.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning: string | Error, ...rest: unknown[]): void => {
  const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string })?.type
  if (type === 'ExperimentalWarning') return
  ;(emitWarning as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest)
}

const { DatabaseSync } = await import('node:sqlite')

export type SqlValue = string | number | bigint | null | Uint8Array
export type Row = Record<string, SqlValue>

/** What the rest of Factory is allowed to assume about the database. */
export interface Database {
  /** Run statements with no results — DDL, pragmas. */
  exec(sql: string): void
  /** Every row a query returns. */
  all<T = Row>(sql: string, ...params: SqlValue[]): T[]
  /** The first row, or undefined. */
  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined
  /** A write. Returns how many rows it touched. */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint }
  /**
   * Run a function inside a transaction, rolling back if it throws.
   *
   * Not re-entrant on purpose: a nested transaction would silently become a
   * no-op, so the outer one has to own the boundary.
   */
  transaction<T>(work: () => T): T
  close(): void
  readonly path: string
}

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path)

  // WAL so a reader is never blocked by the writer — the daemon serves the
  // board while a run is writing to it.
  db.exec('PRAGMA journal_mode = WAL')
  // Off by default in SQLite, which makes every foreign key decorative.
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  let depth = 0

  return {
    path,
    exec: (sql) => db.exec(sql),
    all: <T>(sql: string, ...params: SqlValue[]) =>
      db.prepare(sql).all(...params) as unknown as T[],
    get: <T>(sql: string, ...params: SqlValue[]) =>
      db.prepare(sql).get(...params) as unknown as T | undefined,
    run: (sql, ...params) => {
      const result = db.prepare(sql).run(...params)
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      }
    },
    transaction: <T>(work: () => T): T => {
      if (depth > 0) {
        throw new Error(
          'Nested transaction. SQLite has no nested transactions, so an inner BEGIN would ' +
            'silently join the outer one and an inner rollback would discard both. Pass the ' +
            'work into the outer transaction instead.',
        )
      }
      depth += 1
      db.exec('BEGIN')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        depth -= 1
      }
    },
    close: () => db.close(),
  }
}
