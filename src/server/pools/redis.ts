import "server-only";

import { Redis } from "@upstash/redis";

let client: Redis | null = null;

/**
 * The Upstash Redis store that holds the pool data. Created on first use so that importing this module
 * (for example during `next build`) needs no credentials. The variable names are the ones the Vercel
 * storage integration sets.
 *
 * Options: `automaticDeserialization` stays on, so a field written as a JSON string (the `data` field of a
 * data hash) or a number reads back parsed, and telemetry is off.
 */
export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
  }
  client = new Redis({ url, token, automaticDeserialization: true, enableTelemetry: false });
  return client;
}
