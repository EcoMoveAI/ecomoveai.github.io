import initSqlJs from 'sql.js';
import type { SqlDriver } from '@/db/driver';
import { wrapSqlJsDatabase, type SqlJsDatabase } from '@/db/sqljsDriver';

/** In-memory SQLite (sql.js / WASM) through the same adapter the web build uses. */
export async function createSqlJsDriver(onWrite?: () => void): Promise<SqlDriver> {
  const SQL = await initSqlJs();
  return wrapSqlJsDatabase(new SQL.Database() as unknown as SqlJsDatabase, onWrite);
}
