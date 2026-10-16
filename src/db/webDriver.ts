/**
 * Browser storage for the PWA: SQLite (sql.js / WebAssembly) kept in memory and persisted as a single
 * snapshot in IndexedDB after every change. The same schema and Repository as the native app are used.
 *
 * - sql.js is served from /vendor/sqljs/ (copied from node_modules by scripts/copy-web-vendor.mjs) and
 *   loaded with a <script> tag, so the WASM binary is precached by the service worker like any asset.
 * - IndexedDB is private to this origin and browser profile. It is not a backup: clearing site data
 *   deletes it. Data is only backed up when the user signs in and it has synced.
 * - Other tabs are told about changes through a BroadcastChannel and reload the snapshot.
 */
import { BASE_PATH } from '@/config';
import type { SqlDriver } from './driver';
import { wrapSqlJsDatabase, type SqlJsDatabase } from './sqljsDriver';

const IDB_NAME = 'ecomove';
const IDB_STORE = 'sqlite';
const IDB_KEY = 'ecomove.db';
const SQLJS_BASE = `${BASE_PATH}/vendor/sqljs/`;
const CHANNEL = 'ecomove-db';

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}
declare global {
  interface Window {
    initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window.initSqlJs === 'function') return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load the local database engine. Reload the page.'));
    document.head.appendChild(el);
  });
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is unavailable (private browsing may block it).'));
  });
}

function idbGet(idb: IDBDatabase): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(idb: IDBDatabase, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface WebDriverHandle {
  driver: SqlDriver;
  /** Resolves when all writes so far are stored in IndexedDB. */
  flush(): Promise<void>;
}

/** Opens the persisted database. `onExternalChange` fires when another tab changed the data. */
export async function openWebDriver(onExternalChange?: () => void): Promise<WebDriverHandle> {
  await loadScript(`${SQLJS_BASE}sql-wasm.js`);
  if (!window.initSqlJs) throw new Error('The local database engine did not initialise.');
  const SQL = await window.initSqlJs({ locateFile: (f) => `${SQLJS_BASE}${f}` });
  const idb = await openIdb();
  let db = new SQL.Database((await idbGet(idb)) ?? undefined);
  // Ask the browser not to evict this origin's storage under pressure (best effort, may be refused).
  void navigator.storage?.persist?.().catch(() => undefined);

  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  let saving: Promise<void> = Promise.resolve();
  let dirty = false;

  const persist = () => {
    dirty = true;
    saving = saving.then(async () => {
      if (!dirty) return;
      dirty = false;
      await idbPut(idb, db.export());
      channel?.postMessage('changed');
    }).catch(() => undefined);
  };

  // Every call goes through `current` so a reload from another tab swaps the database underneath.
  let current = wrapSqlJsDatabase(db, persist);
  if (channel) {
    channel.onmessage = async () => {
      await saving;
      const bytes = await idbGet(idb);
      if (!bytes) return;
      db = new SQL.Database(bytes);
      current = wrapSqlJsDatabase(db, persist);
      onExternalChange?.();
    };
  }
  // Last chance to persist before the tab closes (IndexedDB writes are usually already done).
  window.addEventListener('pagehide', () => {
    if (dirty) persist();
  });

  const driver: SqlDriver = {
    exec: (sql) => current.exec(sql),
    run: (sql, params) => current.run(sql, params),
    all: (sql, params) => current.all(sql, params),
    first: (sql, params) => current.first(sql, params),
    transaction: (fn) => current.transaction(fn),
  };
  return { driver, flush: () => saving };
}
