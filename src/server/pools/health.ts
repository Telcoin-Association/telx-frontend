import "server-only";

import { readPartMeta, readStatus } from "./cache";
import { GROUPS, poolsFor, protocolChainOf, type Group } from "./registry";
import { CHAINS } from "./rpc/chains";
import { v3Key } from "./rpc/store";

export type Schedule = "5m";

/** A key is stale when missing or older than this: three missed 5-minute runs. */
export const STALE_AFTER_SECONDS: Record<Schedule, number> = { "5m": 900 };

/** Groups with an active pool decide `ok`; a chain with only archived pools is reported but does not. */
const gates = (group: Group) => {
  const { protocol, chain } = protocolChainOf(group);
  return poolsFor(protocol, chain).some((pool) => pool.active);
};

/**
 * A key is lagging when the block it came from was more than its chain's `lagLimitSeconds` (rpc/chains.ts)
 * behind the fetch time. The pipeline reads each chain up to its `headTag` block (rpc/chains.ts): `safe` on
 * Base and Ethereum, `finalized` on Polygon.
 */
type HealthKey = { key: string; schedule: Schedule; gating: boolean; group: Group; lagLimitSeconds: number };

/** Every data key: each chain's RPC pipeline key. */
export const HEALTH_KEYS: HealthKey[] = GROUPS.map((group): HealthKey => {
  const { chain } = protocolChainOf(group);
  return { key: v3Key(chain), schedule: "5m", gating: gates(group), group, lagLimitSeconds: CHAINS[chain].lagLimitSeconds };
});

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
    HEALTH_KEYS.map(async ({ key, schedule, gating, lagLimitSeconds }): Promise<[string, KeyHealth]> => {
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
          lagging: indexingLagSeconds !== null && indexingLagSeconds > lagLimitSeconds,
          gating,
          ...status,
        },
      ];
    }),
  );

  const keys = Object.fromEntries(entries);
  return { ok: entries.every(([, health]) => !health.gating || (!health.stale && !health.lagging)), now, keys };
}
