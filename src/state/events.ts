type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifies mounted screens that local data changed (e.g. the background task saved a trip). */
export function emitDataChanged(): void {
  for (const l of listeners) l();
}

export function onDataChanged(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
