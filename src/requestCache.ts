export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(new DOMException("Obsolete request", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Obsolete request", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export class RequestCache {
  private entries = new Map<
    string,
    {
      value?: unknown;
      expires: number;
      pending?: Promise<unknown>;
      controller: AbortController;
      subscribers: number;
    }
  >();
  constructor(private now = () => Date.now()) {}
  clear() {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }
  private subscribe<T>(
    key: string,
    entry: {
      controller: AbortController;
      subscribers: number;
      pending?: Promise<unknown>;
    },
    pending: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    entry.subscribers++;
    return abortable(pending, signal).finally(() => {
      entry.subscribers--;
      if (!entry.subscribers && entry.pending) {
        entry.controller.abort();
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
    });
  }
  async get<T>(
    key: string,
    ttl: number,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted)
      throw new DOMException("Obsolete request", "AbortError");
    const prior = this.entries.get(key);
    if (prior?.pending)
      return this.subscribe(key, prior, prior.pending as Promise<T>, signal);
    if (prior && prior.expires > this.now())
      return structuredClone(prior.value) as T;
    const entry: {
      value?: unknown;
      expires: number;
      pending?: Promise<T>;
      controller: AbortController;
      subscribers: number;
    } = { expires: 0, controller: new AbortController(), subscribers: 0 };
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
    return this.subscribe(key, entry, pending, signal);
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
