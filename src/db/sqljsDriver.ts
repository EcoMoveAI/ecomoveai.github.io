/**
 * Adapts a sql.js (SQLite compiled to WebAssembly) database to the app's `SqlDriver` interface.
 * Used by the web build (persisted to IndexedDB, see webDriver.ts) and by the tests (in memory).
 */
import type { SqlDriver, SqlParam } from './driver';

/** The subset of the sql.js `Database` API used here (avoids a type dependency on sql.js in the app). */
export interface SqlJsDatabase {
  exec(sql: string): unknown;
  run(sql: string, params?: SqlParam[]): unknown;
  prepare(sql: string): {
    bind(params: SqlParam[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  };
  getRowsModified(): number;
  export(): Uint8Array;
}

/**
 * `onWrite` runs after every statement that may have changed data, outside open transactions,
 * so the caller can persist a consistent snapshot.
 */
export function wrapSqlJsDatabase(db: SqlJsDatabase, onWrite?: () => void): SqlDriver {
  let inTransaction = false;
  let queue: Promise<void> = Promise.resolve();
  const wrote = () => {
    if (!inTransaction) onWrite?.();
  };
  const all = async <T,>(sql: string, params: SqlParam[] = []): Promise<T[]> => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };
  return {
    exec: async (sql) => {
      db.exec(sql);
      wrote();
    },
    run: async (sql, params = []) => {
      db.run(sql, params);
      const changes = db.getRowsModified();
      wrote();
      return { changes };
    },
    all,
    first: async <T,>(sql: string, params: SqlParam[] = []) => (await all<T>(sql, params))[0] ?? null,
    // sql.js has a single connection, so overlapping async transactions are serialised here.
    transaction: (fn) => {
      const next = queue.then(async () => {
        db.exec('BEGIN');
        inTransaction = true;
        try {
          await fn();
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        } finally {
          inTransaction = false;
        }
        onWrite?.();
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
