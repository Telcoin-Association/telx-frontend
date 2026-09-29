import "server-only";

import type { GraphClient } from "./graph";

/** Test helpers shared by the server pool suites. */

export type QueryResult = Awaited<ReturnType<GraphClient["query"]>>;

/** A GraphClient whose query resolves with `results` in order. */
export function fakeClient(...results: QueryResult[]) {
  const query = jest.fn() as jest.MockedFunction<GraphClient["query"]>;
  for (const result of results) query.mockResolvedValueOnce(result);
  return { client: { query } satisfies GraphClient, query };
}

/** A Redis double with the hash commands the cache uses. */
export function fakeRedis() {
  return { hgetall: jest.fn(), hmget: jest.fn(), hset: jest.fn(), hdel: jest.fn() };
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
    async set(key: string, value: string, options: { nx: true; px: number }) {
      const entry = strings.get(key);
      if (options.nx && entry && entry.expiresAt > Date.now()) return null;
      strings.set(key, { value, expiresAt: Date.now() + options.px });
      return "OK";
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
