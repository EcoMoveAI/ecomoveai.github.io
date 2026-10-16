/**
 * Minimal async SQL interface. The app uses expo-sqlite; tests use sql.js through the same interface.
 */
export type SqlParam = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  transaction(fn: () => Promise<void>): Promise<void>;
}
