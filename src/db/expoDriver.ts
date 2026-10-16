import * as SQLite from 'expo-sqlite';
import type { SqlDriver } from './driver';

export const DATABASE_NAME = 'ecomove.db';

export async function openExpoDriver(): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // WAL lets the background location task and the UI use separate connections safely.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: (sql, params = []) => db.getAllAsync(sql, params),
    first: (sql, params = []) => db.getFirstAsync(sql, params),
    transaction: (fn) => db.withTransactionAsync(fn),
  };
}
