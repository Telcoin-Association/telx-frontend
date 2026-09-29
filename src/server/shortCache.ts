import "server-only";

type Entry<T> = { value: T; expires: number };

export type ShortCache<T> = {
  /**
   * The cached value for `key` when it is still fresh and `accept` (if given) approves it, otherwise the
   * result of `load`. Concurrent calls for one key share a single in-flight `load`. A rejected load is not
   * cached, so the next call tries again.
   */
  get(key: string, load: () => Promise<T>, accept?: (value: T) => boolean): Promise<T>;
  clear(): void;
};

/**
 * A small in-process cache with in-flight sharing, for bursts of identical requests on one server
 * instance. It holds at most `maxEntries` keys and drops the oldest first. Each serverless instance keeps
 * its own copy, so this only smooths bursts; it is not a shared cache.
 */
export function createShortCache<T>({
  ttlMs,
  maxEntries = 500,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): ShortCache<T> {
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  function remember(key: string, value: T) {
    entries.delete(key);
    entries.set(key, { value, expires: now() + ttlMs });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  async function start(key: string, load: () => Promise<T>): Promise<T> {
    const promise = load().then(value => {
      remember(key, value);
      return value;
    });
    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }
  }

  return {
    async get(key, load, accept = () => true) {
      const cached = entries.get(key);
      if (cached && cached.expires > now() && accept(cached.value)) return cached.value;

      const pending = inFlight.get(key);
      if (pending) {
        const shared = await pending;
        if (accept(shared)) return shared;
      }
      return start(key, load);
    },
    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}
