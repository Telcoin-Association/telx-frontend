import "server-only";

import { Redis } from "@upstash/redis";

/**
 * One retry after a short pause. A dropped connection gets a second attempt, while an outage fails in
 * about the deadline instead of waiting out a long backoff. The client retries only when `fetch` throws;
 * an HTTP error from Upstash fails at once.
 */
export const REDIS_RETRY = { retries: 1, backoff: () => 100 };

/**
 * Deadline per command for the reads behind GET /api/pools. Every page load waits on that route, so a
 * slow or unreachable Redis should turn into a failed group within seconds rather than hold the page.
 */
export const POOLS_READ_DEADLINE_MS = 4_000;

/**
 * Deadline per command for everything else: the cron writes (a group's `data` field is a large JSON
 * string), the status hashes and the health check. Long enough for a large `hset` on a slow link, and
 * well inside the cron function's 180 s limit.
 */
export const DEFAULT_DEADLINE_MS = 30_000;

/**
 * The client takes `signal` as a function and calls it once per command, so one deadline covers the
 * first attempt and the retry. A fixed `AbortSignal` would not work: after it aborts, the client resolves
 * every command with a fake `"Aborted"` result instead of throwing.
 */
const deadline = (ms: number) => () => AbortSignal.timeout(ms);

let client: Redis | null = null;
let poolsReadClient: Redis | null = null;

function credentials(): { url: string; token: string } {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
  }
  return { url, token };
}

/**
 * The Upstash Redis store that holds the pool data. Created on first use so that importing this module
 * (for example during `next build`) needs no credentials. The variable names are the ones the Vercel
 * storage integration sets.
 *
 * Options: `automaticDeserialization` stays on, so a field written as a JSON string (the `data` field of a
 * data hash) or a number reads back parsed, and telemetry is off. Commands get one retry and the
 * `DEFAULT_DEADLINE_MS` deadline.
 */
export function getRedis(): Redis {
  if (client) return client;

  client = new Redis({
    ...credentials(),
    automaticDeserialization: true,
    enableTelemetry: false,
    retry: REDIS_RETRY,
    signal: deadline(DEFAULT_DEADLINE_MS),
  });
  return client;
}

/**
 * A read-only client for GET /api/pools, with the short `POOLS_READ_DEADLINE_MS` deadline.
 *
 * `automaticDeserialization` is off: `hgetall` returns the raw `[field, value, ...]` reply and the caller
 * parses the fields. In a pipeline run with `keepErrors`, a failed command has no result, and the parsing
 * `hgetall` deserializer throws on that, which would fail every command in the batch.
 */
export function getPoolsReadRedis(): Redis {
  if (poolsReadClient) return poolsReadClient;

  poolsReadClient = new Redis({
    ...credentials(),
    automaticDeserialization: false,
    enableTelemetry: false,
    retry: REDIS_RETRY,
    signal: deadline(POOLS_READ_DEADLINE_MS),
  });
  return poolsReadClient;
}
