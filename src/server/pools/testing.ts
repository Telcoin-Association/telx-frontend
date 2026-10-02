import "server-only";

/** Test helpers shared by the server pool suites. */

/** A Redis double with the hash commands the cache uses. */
export function fakeRedis() {
  // `multi` is a plain function so that jest.resetAllMocks keeps it returning the transaction double.
  const transaction = { hset: jest.fn(), hdel: jest.fn(), exec: jest.fn() };
  return { hgetall: jest.fn(), hmget: jest.fn(), hset: jest.fn(), hdel: jest.fn(), multi: () => transaction, transaction };
}

/** Sets environment variables for one test; the returned function restores the previous values. */
export function withEnv(values: Record<string, string | undefined>): () => void {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  const apply = (next: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(values);
  return () => apply(previous);
}

/**
 * An in-memory Redis with the hash, string and MULTI commands the RPC pipeline uses. Like the Upstash client
 * with automatic deserialization, it returns each hash field JSON-parsed when it parses and as the stored
 * string otherwise. `failExec` makes the next MULTI fail without applying anything.
 */
export function memoryRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, { value: string; expiresAt: number }>();
  let failNextExec = false;

  const stringify = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  const parse = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  const commands = {
    hset(key: string, values: Record<string, unknown>) {
      const hash = hashes.get(key) ?? new Map<string, string>();
      for (const [field, value] of Object.entries(values)) hash.set(field, stringify(value));
      hashes.set(key, hash);
      return Object.keys(values).length;
    },
    hdel(key: string, ...fields: string[]) {
      const hash = hashes.get(key);
      for (const field of fields) hash?.delete(field);
      if (hash && hash.size === 0) hashes.delete(key);
      return fields.length;
    },
    del(...keys: string[]) {
      for (const key of keys) {
        hashes.delete(key);
        strings.delete(key);
      }
      return keys.length;
    },
  };

  const redis = {
    hashes,
    failExec() {
      failNextExec = true;
    },
    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
      const hash = hashes.get(key);
      if (!hash) return null;
      return Object.fromEntries([...hash].map(([field, value]) => [field, parse(value)])) as T;
    },
    /** Every matching key in one reply; `match` supports `*` only. */
    async scan(_cursor: string, options: { match: string; count: number }): Promise<[string, string[]]> {
      const escape = (part: string) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${options.match.split("*").map(escape).join(".*")}$`);
      return ["0", [...hashes.keys()].filter(key => pattern.test(key))];
    },
    async hmget<T = Record<string, unknown>>(key: string, ...fields: string[]): Promise<T | null> {
      const hash = hashes.get(key);
      if (!hash) return null;
      return Object.fromEntries(fields.map(field => [field, hash.has(field) ? parse(hash.get(field)!) : null])) as T;
    },
    async hset(key: string, values: Record<string, unknown>) {
      return commands.hset(key, values);
    },
    async hdel(key: string, ...fields: string[]) {
      return commands.hdel(key, ...fields);
    },
    async del(...keys: string[]) {
      return commands.del(...keys);
    },
    async get<T = unknown>(key: string): Promise<T | null> {
      const entry = strings.get(key);
      return entry && entry.expiresAt > Date.now() ? (entry.value as T) : null;
    },
    async set(key: string, value: string, options?: { nx: true; px: number }) {
      const entry = strings.get(key);
      if (options?.nx && entry && entry.expiresAt > Date.now()) return null;
      strings.set(key, { value, expiresAt: options ? Date.now() + options.px : Number.POSITIVE_INFINITY });
      return "OK";
    },
    /**
     * The one script the app runs, the rewards backfill's guarded write (WRITE_UNLESS_RECORDED in
     * merkl/backfill.ts): sets each field/value pair of `args` in the hash `keys[0]` unless the field holds a
     * row without the chain marker, and returns how many it set.
     */
    async eval(_script: string, keys: string[], args: unknown[]) {
      const hash = hashes.get(keys[0]) ?? new Map<string, string>();
      hashes.set(keys[0], hash);
      let written = 0;
      for (let i = 0; i < args.length; i += 2) {
        const current = hash.get(String(args[i]));
        if (current === undefined || current.includes('"source":"chain"')) {
          hash.set(String(args[i]), String(args[i + 1]));
          written += 1;
        }
      }
      return written;
    },
    multi() {
      const queued: (() => unknown)[] = [];
      const tx = {
        hset: (key: string, values: Record<string, unknown>) => (queued.push(() => commands.hset(key, values)), tx),
        hdel: (key: string, ...fields: string[]) => (queued.push(() => commands.hdel(key, ...fields)), tx),
        del: (...keys: string[]) => (queued.push(() => commands.del(...keys)), tx),
        async exec() {
          if (failNextExec) {
            failNextExec = false;
            throw new Error("EXEC failed");
          }
          return queued.map(run => run());
        },
      };
      return tx;
    },
  };
  return redis;
}

/** An in-memory Vercel Blob store for the history suites. */
export function memoryBlobs() {
  const files = new Map<string, string>();
  return {
    files,
    async write(path: string, body: string) {
      files.set(path, body);
    },
    async read(path: string) {
      return files.get(path) ?? null;
    },
    async list(prefix: string) {
      return [...files.keys()].filter(path => path.startsWith(prefix)).sort();
    },
  };
}
