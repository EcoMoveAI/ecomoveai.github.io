import { emitDataChanged } from '@/state/events';
import { Repository } from './repository';
import { openWebDriver } from './webDriver';

let instance: Promise<Repository> | null = null;

/** Process-wide repository for the web build (sql.js persisted to IndexedDB). */
export function getRepository(): Promise<Repository> {
  instance ??= (async () => {
    const { driver } = await openWebDriver(emitDataChanged);
    const repo = new Repository(driver);
    await repo.migrate();
    return repo;
  })();
  return instance;
}
