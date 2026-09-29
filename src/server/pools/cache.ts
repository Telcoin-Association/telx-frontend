import "server-only";

import type { PoolMetrics } from "@/types/PoolMetrics";

import { getRedis } from "./redis";

export const statusKey = (dataKey: string) => `status:${dataKey}`;

/** One row of a pool's hourly or daily history, as the RPC pipeline writes it. */
export type Row = Record<string, unknown>;

/** One pool as stored in a data key. */
export type CachedPool = {
  id: string;
  pool?: Row;
  poolSnapshots?: Row[];
  threeMonthLiquidityData?: Row[];
  swaps?: Row[];
  metrics?: PoolMetrics | null;
};

export type PartMeta = {
  fetchedAt: number; // ms
  indexedAt: number | null; // ms
  hasIndexingErrors: boolean;
};

export type Snapshot = PartMeta & { data: CachedPool[] };

/** One group's pool data as read from the cache. */
export type GroupedResponse = {
  fetchedAt: number;
  indexedAt: number | null;
  hasIndexingErrors: boolean;
  /**
   * The payload shape the client parses. One key holds the hourly and daily rows together, so both parts carry
   * its freshness; `legacy` is always false.
   */
  parts: { hourly: PartMeta | null; daily: PartMeta | null; legacy: false };
  data: CachedPool[];
};

export type Status = {
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
  /** Problems the last successful run carried on past. */
  warnings: string[];
  /**
   * The Uniswap RPC jobs' report of their last run (block range, chunks, logs, calls, compute units,
   * duration), present only on their keys. Its `toBlock` is the chain's cursor.
   */
  lastRun?: unknown;
};

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Reads a data hash. Returns null when the key is missing or holds no usable data array. */
export async function readSnapshot(key: string): Promise<Snapshot | null> {
  return parseSnapshot(await getRedis().hgetall<Record<string, unknown>>(key));
}

/**
 * Turns the fields of a data hash into a snapshot. Fields may arrive parsed (the default client) or as
 * the raw strings Redis stores. Null when the hash is missing or holds no usable data array.
 */
export function parseSnapshot(raw: Record<string, unknown> | null): Snapshot | null {
  if (!raw) return null;

  // A string here is either a raw field or one the client could not parse, so parse it once more.
  let data = raw.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const fetchedAt = numberOrNull(raw.fetchedAt);
  if (!Array.isArray(data) || fetchedAt === null) return null;

  return {
    fetchedAt,
    indexedAt: numberOrNull(raw.indexedAt),
    hasIndexingErrors: raw.hasIndexingErrors === true || raw.hasIndexingErrors === "true",
    data,
  };
}

/** Freshness fields of a data hash without its (large) data field. Null when the key is missing. */
export async function readPartMeta(key: string): Promise<PartMeta | null> {
  const raw = await getRedis().hmget<Record<string, unknown>>(key, "fetchedAt", "indexedAt", "hasIndexingErrors");
  const fetchedAt = numberOrNull(raw?.fetchedAt);
  if (!raw || fetchedAt === null) return null;
  return {
    fetchedAt,
    indexedAt: numberOrNull(raw.indexedAt),
    hasIndexingErrors: raw.hasIndexingErrors === true || raw.hasIndexingErrors === "true",
  };
}

export async function writeSnapshot(key: string, snapshot: PartMeta & { data: unknown[] }): Promise<void> {
  await getRedis().hset(key, {
    fetchedAt: snapshot.fetchedAt,
    indexedAt: snapshot.indexedAt,
    hasIndexingErrors: snapshot.hasIndexingErrors,
    data: JSON.stringify(snapshot.data),
  });
}

export async function recordFailure(dataKey: string, message: string, now: number = Date.now()): Promise<void> {
  await getRedis().hset(statusKey(dataKey), { lastError: message, lastErrorAt: now });
}

/**
 * Marks a successful run: clears the last error and replaces the warnings with this run's. The write and the
 * clear run as one transaction, so a status hash never pairs a fresh `lastSuccessAt` with a stale `lastError`.
 */
export async function recordSuccess(dataKey: string, warnings: string[] = [], now: number = Date.now()): Promise<void> {
  const key = statusKey(dataKey);
  const transaction = getRedis().multi();
  if (warnings.length) {
    transaction.hset(key, { lastSuccessAt: now, warnings: JSON.stringify(warnings) });
    transaction.hdel(key, "lastError", "lastErrorAt");
  } else {
    transaction.hset(key, { lastSuccessAt: now });
    transaction.hdel(key, "lastError", "lastErrorAt", "warnings");
  }
  await transaction.exec();
}

function warningsOf(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [parsed as string];
    }
  }
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export async function readStatus(dataKey: string): Promise<Status> {
  const raw = await getRedis().hgetall<Record<string, unknown>>(statusKey(dataKey));
  const lastError = raw?.lastError;
  return {
    // the client may have parsed a JSON-looking message into another type
    lastError: lastError === undefined || lastError === null ? null : String(lastError),
    lastErrorAt: numberOrNull(raw?.lastErrorAt),
    lastSuccessAt: numberOrNull(raw?.lastSuccessAt),
    warnings: warningsOf(raw?.warnings),
    ...(raw?.lastRun !== undefined && raw?.lastRun !== null && { lastRun: typeof raw.lastRun === "string" ? parseRun(raw.lastRun) : raw.lastRun }),
  };
}

function parseRun(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const partMeta = ({ fetchedAt, indexedAt, hasIndexingErrors }: Snapshot): PartMeta => ({
  fetchedAt,
  indexedAt,
  hasIndexingErrors,
});

/** The response for one data key: its rows as they are, with its freshness as both parts. */
export function snapshotResponse(snapshot: Snapshot): GroupedResponse {
  return {
    ...partMeta(snapshot),
    parts: { hourly: partMeta(snapshot), daily: partMeta(snapshot), legacy: false },
    data: snapshot.data,
  };
}
