import "server-only";

import poolJson from "@/data/pool.json";
import { poolSymbols, type RegistryPoolForTitle } from "@/lib/poolTitle";

import { parseRewardsDays, rewardsDayKey, type RewardsDayRow } from "../pools/merkl/history";
import { getRedis } from "../pools/redis";
import { rpcPoolsFor, type Chain, type RpcPool } from "../pools/registry";
import { TEL } from "../pools/rpc/chains";
import { dayKey } from "../pools/rpc/store";

/** The chains the analytics cover, in display order. */
export const ANALYTICS_CHAINS: readonly Chain[] = ["polygon", "base", "ethereum"];

/** One pool's figures for one UTC day. A figure is null when it wasn't recorded that day. */
export type AnalyticsDay = {
  /** UTC day start, unix seconds. */
  day: number;
  tvlUSD: number | null;
  volumeUSD: number | null;
  feesUSD: number | null;
  /** Subscribed Value Locked, from the day's Merkl row: only while a campaign is live and measured. */
  svlUSD: number | null;
  apr: number | null;
  /** USD of rewards per day, as Merkl reports it for the live campaigns. */
  dailyRewardsUSD: number | null;
  status: RewardsDayRow["status"] | null;
  /** The day's rewards figures are our estimate from the chain rather than Merkl's own (see merkl/backfill.ts). */
  estimated: boolean;
};

export type AnalyticsPool = { id: string; chain: Chain; name: string; days: AnalyticsDay[] };

export type AnalyticsCampaign = {
  id: string;
  chain: Chain;
  poolId: string;
  poolName: string;
  /** Unix ms, as Merkl reports the window. */
  start: number | null;
  end: number | null;
  /** The largest daily rewards (USD) recorded while it was live. */
  dailyBudgetUSD: number | null;
  aprMin: number | null;
  aprMax: number | null;
  peakSvlUSD: number | null;
  /** Some of the campaign's figures are our estimate from the chain rather than Merkl's own. */
  estimated: boolean;
};

export type AnalyticsResponse = {
  /** The first day any pool has a row, unix seconds, or null before collection has written anything. */
  historyFrom: number | null;
  /**
   * The first day any pool has a Merkl rewards row, unix seconds, or null before the rewards history has a row.
   * It can start later than `historyFrom`: day rows go back to each pool's creation, rewards rows to its first campaign.
   */
  rewardsFrom: number | null;
  pools: AnalyticsPool[];
  campaigns: AnalyticsCampaign[];
  /** TEL's USD price per UTC day (unix seconds as the key), from the closing prices of the TEL pools. */
  telUSD: Record<string, number>;
};

/** A stored pool day row, as far as the analytics read it. */
type StoredDay = { volumeUSD?: unknown; feesUSD?: unknown; tvlUSD?: unknown; price0USD?: unknown; price1USD?: unknown };

/** What the reader loads for one pool: its registry entry and its two raw hashes. */
export type PoolSource = { pool: RpcPool; dayRows: Record<string, unknown> | null; rewardsDays: Record<string, unknown> | null };

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** A pool's day rows by UTC day start (unix seconds). Fields that aren't a day or a row are skipped. */
function parseDayRows(hash: Record<string, unknown> | null): Map<number, StoredDay> {
  const days = new Map<number, StoredDay>();
  for (const [field, value] of Object.entries(hash ?? {})) {
    const day = Number(field);
    const row = parseValue(value);
    if (Number.isInteger(day) && day > 0 && row && typeof row === "object") days.set(day, row as StoredDay);
  }
  return days;
}

const registryEntries = poolJson as unknown as RegistryPoolForTitle[];

/** "WETH/TEL", from the pool's token symbols in pool.json, or its registry name when they aren't there. */
export function analyticsPoolName(pool: Pick<RpcPool, "id" | "chain" | "name">): string {
  const entry = registryEntries.find(
    item => item.attributes.pool_address?.toLowerCase() === pool.id && (item.attributes.blockchain ?? "").toLowerCase() === pool.chain,
  );
  const symbols = entry ? poolSymbols(entry) : [];
  return symbols.length ? symbols.join("/") : pool.name;
}

/**
 * The analytics series from each pool's stored day rows and Merkl rewards history: one row per pool per day on
 * which either was recorded, oldest first, the campaigns seen in the rewards history, and TEL's daily price.
 */
export function assembleAnalytics(sources: readonly PoolSource[]): AnalyticsResponse {
  const telPrices = new Map<number, number[]>();
  const campaigns = new Map<string, AnalyticsCampaign>();
  let historyFrom: number | null = null;
  let rewardsFrom: number | null = null;

  const pools = sources.map(({ pool, dayRows, rewardsDays }): AnalyticsPool => {
    const name = analyticsPoolName(pool);
    const stored = parseDayRows(dayRows);
    const rewards = new Map(parseRewardsDays(rewardsDays));
    for (const day of rewards.keys()) if (rewardsFrom === null || day < rewardsFrom) rewardsFrom = day;
    const telSide = pool.key.currency0.toLowerCase() === TEL ? "price0USD" : pool.key.currency1.toLowerCase() === TEL ? "price1USD" : null;

    const days = [...new Set([...stored.keys(), ...rewards.keys()])].sort((a, b) => a - b).map((day): AnalyticsDay => {
      const row = stored.get(day);
      const merkl = rewards.get(day);
      if (telSide && row) {
        const price = finite(row[telSide]);
        if (price !== null && price > 0) telPrices.set(day, [...(telPrices.get(day) ?? []), price]);
      }
      if (merkl) {
        for (const id of merkl.campaignIds) {
          const key = `${pool.chain}:${pool.id}:${id}`;
          const seen = campaigns.get(key) ?? {
            id,
            chain: pool.chain,
            poolId: pool.id,
            poolName: name,
            start: merkl.campaignStart,
            end: merkl.campaignEnd,
            dailyBudgetUSD: null,
            aprMin: null,
            aprMax: null,
            peakSvlUSD: null,
            estimated: false,
          };
          const max = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
          const min = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
          campaigns.set(key, {
            ...seen,
            start: min(seen.start, merkl.campaignStart),
            end: max(seen.end, merkl.campaignEnd),
            dailyBudgetUSD: max(seen.dailyBudgetUSD, merkl.dailyRewards),
            aprMin: min(seen.aprMin, merkl.apr),
            aprMax: max(seen.aprMax, merkl.apr),
            peakSvlUSD: max(seen.peakSvlUSD, merkl.subscribedTvlUSD),
            estimated: seen.estimated || merkl.source === "chain",
          });
        }
      }
      return {
        day,
        tvlUSD: finite(row?.tvlUSD),
        volumeUSD: finite(row?.volumeUSD),
        feesUSD: finite(row?.feesUSD),
        svlUSD: merkl?.status === "LIVE" ? merkl.subscribedTvlUSD : null,
        apr: merkl?.status === "LIVE" ? merkl.apr : null,
        dailyRewardsUSD: merkl?.status === "LIVE" ? merkl.dailyRewards : null,
        status: merkl?.status ?? null,
        estimated: merkl?.source === "chain",
      };
    });
    if (days.length && (historyFrom === null || days[0].day < historyFrom)) historyFrom = days[0].day;
    return { id: pool.id, chain: pool.chain, name, days };
  });

  const telUSD: Record<string, number> = {};
  for (const [day, prices] of telPrices) telUSD[String(day)] = prices.reduce((sum, price) => sum + price, 0) / prices.length;

  return { historyFrom, rewardsFrom, pools, campaigns: [...campaigns.values()].sort((a, b) => (b.start ?? 0) - (a.start ?? 0)), telUSD };
}

type Pipeline = { hgetall(key: string): unknown; exec(): Promise<unknown[]> };
export type AnalyticsRedis = { pipeline(): Pipeline };

/** Reads every active Uniswap pool's day rows and rewards history in one pipelined request, and assembles them. */
export async function readAnalytics(redis: AnalyticsRedis = getRedis() as unknown as AnalyticsRedis): Promise<AnalyticsResponse> {
  const pools = ANALYTICS_CHAINS.flatMap(chain => rpcPoolsFor(chain));
  const pipeline = redis.pipeline();
  for (const pool of pools) {
    pipeline.hgetall(dayKey(pool.chain, pool.id));
    pipeline.hgetall(rewardsDayKey(pool.chain, pool.id));
  }
  const replies = pools.length ? await pipeline.exec() : [];
  const hash = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);
  return assembleAnalytics(pools.map((pool, i) => ({ pool, dayRows: hash(replies[2 * i]), rewardsDays: hash(replies[2 * i + 1]) })));
}
