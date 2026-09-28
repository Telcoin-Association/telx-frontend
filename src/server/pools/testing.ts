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
