export class RequestCache {
  private entries = new Map<
    string,
    {
      value?: unknown;
      expires: number;
      pending?: Promise<unknown>;
      controller: AbortController;
    }
  >();
  constructor(private now = () => Date.now()) {}
  clear() {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }
  async get<T>(
    key: string,
    ttl: number,
    load: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const prior = this.entries.get(key);
    if (prior?.pending) return prior.pending as Promise<T>;
    if (prior && prior.expires > this.now())
      return structuredClone(prior.value) as T;
    const entry: {
      value?: unknown;
      expires: number;
      pending?: Promise<T>;
      controller: AbortController;
    } = { expires: 0, controller: new AbortController() };
    const pending = load(entry.controller.signal)
      .then((value) => {
        if (entry.controller.signal.aborted)
          throw new DOMException("Obsolete request", "AbortError");
        if (this.entries.get(key) === entry) {
          entry.value = structuredClone(value);
          entry.expires = this.now() + ttl;
          entry.pending = undefined;
        }
        return value;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }
}
export const privateRequests = new RequestCache();
export const publicRequests = new RequestCache();
let generation = 0;
export const cacheScope = () => generation;
export function clearPrivateCache() {
  generation++;
  privateRequests.clear();
}
