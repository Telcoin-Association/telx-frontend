import "server-only";

import { SPLIT_GROUPS, dailyKey, hourlyKey, quickswapKey, readPartMeta, readStatus } from "./cache";
import { poolsFor, protocolChainOf, type Group } from "./registry";

export type Schedule = "5m" | "1h";

/** A key is stale when missing or older than this. Three missed runs for 5m keys, three hours for 1h keys. */
export const STALE_AFTER_SECONDS: Record<Schedule, number> = { "5m": 900, "1h": 10800 };

/** A key is lagging when the subgraph block it came from was more than this behind the fetch time. */
export const LAGGING_AFTER_SECONDS = 3600;

/** Keys for groups with an active pool decide `ok`; archive-only groups are reported but do not. */
const gates = (group: Group) => {
  const { protocol, chain } = protocolChainOf(group);
  return poolsFor(protocol, chain).some((pool) => pool.active);
};

export const HEALTH_KEYS: { key: string; schedule: Schedule; gating: boolean }[] = [
  ...SPLIT_GROUPS.map((group) => ({ key: hourlyKey(group), schedule: "5m" as const, gating: gates(group) })),
  ...SPLIT_GROUPS.map((group) => ({ key: dailyKey(group), schedule: "1h" as const, gating: gates(group) })),
  { key: quickswapKey, schedule: "1h", gating: gates("quickswap") },
];

export type KeyHealth = {
  schedule: Schedule;
  fetchedAt: number | null; // ms
  ageSeconds: number | null;
  indexedAt: number | null; // ms
  indexedAgeSeconds: number | null;
  indexingLagSeconds: number | null; // fetchedAt - indexedAt
  hasIndexingErrors: boolean | null;
  stale: boolean; // missing, or fetched too long ago
  lagging: boolean; // fetched in time, but from a block too far behind
  gating: boolean; // whether this key can make `ok` false
  lastError: string | null;
  lastErrorAt: number | null; // ms
  lastSuccessAt: number | null; // ms
  warnings: string[]; // from the last successful run; they do not affect `ok`
};

export type Health = { ok: boolean; now: number; keys: Record<string, KeyHealth> };

const secondsSince = (now: number, at: number | null) => (at === null ? null : Math.floor((now - at) / 1000));

/** Freshness and last cron outcome of every data key. `now` is in ms. */
export async function buildHealth(now: number): Promise<Health> {
  const entries = await Promise.all(
    HEALTH_KEYS.map(async ({ key, schedule, gating }): Promise<[string, KeyHealth]> => {
      const [meta, status] = await Promise.all([readPartMeta(key), readStatus(key)]);
      const ageSeconds = secondsSince(now, meta?.fetchedAt ?? null);
      const indexingLagSeconds =
        meta?.fetchedAt != null && meta.indexedAt != null ? Math.floor((meta.fetchedAt - meta.indexedAt) / 1000) : null;
      return [
        key,
        {
          schedule,
          fetchedAt: meta?.fetchedAt ?? null,
          ageSeconds,
          indexedAt: meta?.indexedAt ?? null,
          indexedAgeSeconds: secondsSince(now, meta?.indexedAt ?? null),
          indexingLagSeconds,
          hasIndexingErrors: meta?.hasIndexingErrors ?? null,
          stale: ageSeconds === null || ageSeconds > STALE_AFTER_SECONDS[schedule],
          lagging: indexingLagSeconds !== null && indexingLagSeconds > LAGGING_AFTER_SECONDS,
          gating,
          ...status,
        },
      ];
    }),
  );

  const keys = Object.fromEntries(entries);
  return { ok: entries.every(([, health]) => !health.gating || (!health.stale && !health.lagging)), now, keys };
}
