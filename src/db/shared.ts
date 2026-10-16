import { openExpoDriver } from './expoDriver';
import { Repository } from './repository';

let instance: Promise<Repository> | null = null;

/** Process-wide repository (also used by the headless background task, where React is not mounted). */
export function getRepository(): Promise<Repository> {
  instance ??= (async () => {
    const repo = new Repository(await openExpoDriver());
    await repo.migrate();
    return repo;
  })();
  return instance;
}
