import "server-only";

import { SPLIT_GROUPS, dailyKey, hourlyKey, quickswapKey, readPartMeta, readStatus } from "./cache";
import { poolsFor, protocolChainOf, type Group } from "./registry";
import { CHAINS } from "./rpc/chains";
import { gatingKeysOf, readGroupSources, v3ChainOf } from "./rpc/source";
import { v3Key } from "./rpc/store";

export type Schedule = "5m" | "1h";

/** A key is stale when missing or older than this. Three missed runs for 5m keys, three hours for 1h keys. */
export const STALE_AFTER_SECONDS: Record<Schedule, number> = { "5m": 900, "1h": 10800 };

/**
 * A key is lagging when the block it came from was more than this behind the fetch time. The RPC pipeline's
 * keys use their chain's limit instead (`lagLimitSeconds` in rpc/chains.ts), since they read the finalized
 * block, which trails the head by up to about 21 minutes on Base.
 */
export const LAGGING_AFTER_SECONDS = 3600;

/** Keys for groups with an active pool decide `ok`; archive-only groups are reported but do not. */
const gates = (group: Group) => {
  const { protocol, chain } = protocolChainOf(group);
  return poolsFor(protocol, chain).some((pool) => pool.active);
};

/** `source` says which of a Uniswap group's key sets the key belongs to: its subgraph keys (`v2`) or its v3 key. */
type HealthKey = { key: string; schedule: Schedule; gating: boolean; group: Group; source: "v2" | "v3"; lagLimitSeconds: number };

const subgraphKey = (key: string, schedule: Schedule, group: Group): HealthKey => ({
  key,
  schedule,
  gating: gates(group),
  group,
  source: "v2",
  lagLimitSeconds: LAGGING_AFTER_SECONDS,
});

/**
 * Every data key. `gating` says whether the key's group has an active pool; for a Uniswap group, only the keys
 * its source gates on (`gatingKeysOf` in rpc/source.ts) can make `ok` false.
 */
export const HEALTH_KEYS: HealthKey[] = [
  ...SPLIT_GROUPS.map((group) => subgraphKey(hourlyKey(group), "5m", group)),
  ...SPLIT_GROUPS.map((group) => subgraphKey(dailyKey(group), "1h", group)),
  subgraphKey(quickswapKey, "1h", "quickswap"),
  ...(["uniswap-polygon", "uniswap-base", "uniswap-ethereum"] as const).map((group): HealthKey => {
    const chain = v3ChainOf(group) as keyof typeof CHAINS;
    return { key: v3Key(chain), schedule: "5m", gating: gates(group), group, source: "v3", lagLimitSeconds: CHAINS[chain].lagLimitSeconds };
  }),
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
  const sources = await readGroupSources();
  const gatesOn = (group: Group, keys: "v2" | "v3") => !v3ChainOf(group) || gatingKeysOf(sources[group] ?? "v2") === keys;
  const entries = await Promise.all(
    HEALTH_KEYS.map(async ({ key, schedule, gating, group, source, lagLimitSeconds }): Promise<[string, KeyHealth]> => {
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
          gating: gating && gatesOn(group, source),
          ...status,
        },
      ];
    }),
  );

  const keys = Object.fromEntries(entries);
  return { ok: entries.every(([, health]) => !health.gating || (!health.stale && !health.lagging)), now, keys };
}
