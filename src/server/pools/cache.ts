import "server-only";

import type { PoolMetrics, Row } from "./metrics";
import { getRedis } from "./redis";
import type { Group } from "./registry";

/** Groups whose data is split into an hourly-rows key (every 5 min) and a daily-rows key (hourly). */
export type SplitGroup = Exclude<Group, "quickswap">;
export const SPLIT_GROUPS: readonly SplitGroup[] = ["uniswap-base", "uniswap-polygon", "uniswap-ethereum", "balancer"];

export const hourlyKey = (group: SplitGroup) => `active-${group}-grouped:hourly:v2`;
export const dailyKey = (group: SplitGroup) => `active-${group}-grouped:daily:v2`;
export const quickswapKey = "active-quickswap-grouped:v2";
export const statusKey = (dataKey: string) => `status:${dataKey}`;

/** One pool as stored in any data key. Which fields are present depends on the key. */
export type CachedPool = {
  id: string;
  pool?: Row;
  poolSnapshots?: Row[];
  threeMonthLiquidityData?: Row[];
  swaps?: Row[];
  metrics?: PoolMetrics;
};

export type PartMeta = {
  fetchedAt: number; // ms
  indexedAt: number | null; // ms
  hasIndexingErrors: boolean;
};

export type Snapshot = PartMeta & { data: CachedPool[] };

export type MergedPool = {
  id: string;
  pool: Row | null;
  poolSnapshots: Row[];
  threeMonthLiquidityData: Row[];
  swaps?: Row[];
  /** null when the hourly part, the only part that carries metrics, is missing. */
  metrics?: PoolMetrics | null;
};

/** One group's pool data as read from the cache. */
export type GroupedResponse = {
  fetchedAt: number;
  indexedAt: number | null;
  hasIndexingErrors: boolean;
  /** `legacy` is always false for this app's data; it is part of the payload shape the client parses. */
  parts: { hourly: PartMeta | null; daily: PartMeta | null; legacy: false };
  data: MergedPool[] | CachedPool[];
};

export type Status = {
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
  /** Problems the last successful run carried on past, such as an archived pool the subgraph did not return. */
  warnings: string[];
};

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Reads a data hash. Returns null when the key is missing or holds no usable data array. */
export async function readSnapshot(key: string): Promise<Snapshot | null> {
  const raw = await getRedis().hgetall<Record<string, unknown>>(key);
  if (!raw) return null;

  // The client JSON-parses fields on read; a string here means it could not, so try once more.
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

/** Marks a successful run: clears the last error and replaces the warnings with this run's. */
export async function recordSuccess(dataKey: string, warnings: string[] = [], now: number = Date.now()): Promise<void> {
  const redis = getRedis();
  const key = statusKey(dataKey);
  if (warnings.length) {
    await redis.hset(key, { lastSuccessAt: now, warnings: JSON.stringify(warnings) });
    await redis.hdel(key, "lastError", "lastErrorAt");
  } else {
    await redis.hset(key, { lastSuccessAt: now });
    await redis.hdel(key, "lastError", "lastErrorAt", "warnings");
  }
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
  };
}

const partMeta = ({ fetchedAt, indexedAt, hasIndexingErrors }: Snapshot): PartMeta => ({
  fetchedAt,
  indexedAt,
  hasIndexingErrors,
});

/**
 * Joins the hourly part (hourly rows, swaps, metrics) and the daily part (95 days of daily rows)
 * per pool id. Freshness comes from the hourly part when present. Without the hourly part every pool
 * gets `metrics: null`, so a reader knows the values are unknown rather than missing from an older
 * payload. Null when neither part exists.
 */
export function mergeGroupedParts(hourly: Snapshot | null, daily: Snapshot | null): GroupedResponse | null {
  const primary = hourly ?? daily;
  if (!primary) return null;

  const hourlyById = new Map((hourly?.data ?? []).map(pool => [pool.id, pool]));
  const dailyById = new Map((daily?.data ?? []).map(pool => [pool.id, pool]));
  const ids = [...new Set([...hourlyById.keys(), ...dailyById.keys()])];

  const data = ids.map((id): MergedPool => {
    const h = hourlyById.get(id);
    const d = dailyById.get(id);
    const merged: MergedPool = {
      id,
      pool: h?.pool ?? d?.pool ?? null,
      poolSnapshots: h?.poolSnapshots ?? [],
      threeMonthLiquidityData: d?.threeMonthLiquidityData ?? [],
    };
    if (h?.swaps) merged.swaps = h.swaps;
    if (!hourly) merged.metrics = null;
    else if (h?.metrics) merged.metrics = h.metrics;
    return merged;
  });

  return {
    fetchedAt: primary.fetchedAt,
    indexedAt: primary.indexedAt,
    hasIndexingErrors: Boolean(hourly?.hasIndexingErrors || daily?.hasIndexingErrors),
    parts: {
      hourly: hourly && partMeta(hourly),
      daily: daily && partMeta(daily),
      legacy: false,
    },
    data,
  };
}

/** QuickSwap keeps everything in one hourly-refreshed key; it is reported as the daily part. */
export function singlePartResponse(snapshot: Snapshot): GroupedResponse {
  return {
    ...partMeta(snapshot),
    parts: { hourly: null, daily: partMeta(snapshot), legacy: false },
    data: snapshot.data,
  };
}
