import "server-only";

import { decodeFunctionResult, encodeFunctionData, pad, parseAbi, toEventSelector, type Hex } from "viem";

import { MERKL_TELX_SUBSCRIBER } from "@/lib/contracts";
import type { RpcChain } from "@/lib/rpc";
import { readLogChunks, toHex, type RpcRequester } from "@/server/chain/logs";

import { DAY, dayStart } from "../rpc/buckets";
import { TEL, type ChainConfig } from "../rpc/chains";
import { getAmountsForLiquidity, getSqrtPriceAtTick, toUnits } from "../rpc/liquidityMath";
import { priceChain } from "../rpc/pricing";
import { MULTICALL3_ABI } from "../rpc/abi";
import { readChainSnapshot, type ChainSnapshot } from "../rpc/snapshot";
import type { RpcPool } from "../registry";
import { campaignShareOfDay, campaignsOnDay, type Campaign } from "./campaigns";
import { rewardsDayKey, type RewardsDayRow } from "./history";

/**
 * Rebuilds the Merkl rewards history (`merkl-rewards:<chain>:day:<poolId>`) for the days before the Merkl cron
 * recorded it, from each campaign's funding and from the chain:
 *
 * - Daily rewards: each campaign's amount spread evenly per second over its window, summed per UTC day, and
 *   priced at that day's TEL price (the pipeline's own pricing, read at the day's closing block). A reward
 *   token other than TEL is priced at Merkl's current price for it.
 * - SVL: every position that ever subscribed to the TELx subscriber, read at the day's closing block. Those
 *   still subscribed then, with liquidity and in range, are valued at the pool's closing price.
 * - APR: the live campaigns' full-day reward rate over SVL, annualised, as a percentage like Merkl's.
 *
 * Rows carry `source: "chain"`. Merkl's own figures leave out some liquidity and weight fees and each token,
 * so these are close to Merkl's figures rather than equal to them. A row the cron recorded is never replaced;
 * the cron's write replaces a chain row.
 */

/** Rewards history rows derived here, as opposed to Merkl's own figures recorded by the cron. */
export const CHAIN_SOURCE = "chain";

/**
 * The block each chain's TELx subscriber was deployed at. No position subscribed to it earlier, so the
 * subscription logs are read from here.
 */
export const SUBSCRIBER_FROM_BLOCK: Readonly<Record<RpcChain, number>> = {
  polygon: 94_361_472,
  base: 51_728_594,
  ethereum: 26_046_819,
};

/** Positions read per Multicall3 call at a day's block, three sub-calls each. */
export const POSITIONS_PER_CALL = 150;

/** Merkl rewards only in-range liquidity, so out-of-range positions are left out of SVL. */
export const SVL_IN_RANGE_ONLY = true;

const POSITION_MANAGER_ABI = parseAbi([
  "event Subscription(uint256 indexed tokenId, address indexed subscriber)",
  "function positionInfo(uint256 tokenId) view returns (uint256)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function subscriber(uint256 tokenId) view returns (address)",
]);

export const SUBSCRIPTION_TOPIC = toEventSelector(POSITION_MANAGER_ABI[0]);

/** Token ids of every position that subscribed to the TELx subscriber in `[fromBlock, toBlock]`. */
export async function readSubscribedTokenIds(client: RpcRequester, config: ChainConfig, fromBlock: number, toBlock: number, maxSpan: number): Promise<string[]> {
  const ids = new Set<string>();
  if (fromBlock > toBlock) return [];
  const filter = { address: config.contracts.positionManager, topics: [SUBSCRIPTION_TOPIC, null, pad(MERKL_TELX_SUBSCRIBER.toLowerCase() as Hex)] };
  for await (const chunk of readLogChunks(client, filter, fromBlock, toBlock, { maxSpan })) {
    for (const log of chunk.logs) if (!log.removed && log.topics[1]) ids.add(BigInt(log.topics[1]).toString());
  }
  return [...ids];
}

export type BlockTime = { block: number; timestamp: number };

/**
 * The last block before `target` (unix seconds), given `lo` before it and `hi` at or after it. Steps alternate
 * between interpolating on block time and halving, so the search stays logarithmic when block times vary.
 */
export async function lastBlockBefore(timeOf: (block: number) => Promise<number>, target: number, lo: BlockTime, hi: BlockTime): Promise<BlockTime> {
  if (lo.timestamp >= target) throw new Error(`block ${lo.block} is not before ${target}`);
  if (hi.timestamp < target) return hi;
  let interpolate = true;
  while (hi.block - lo.block > 1) {
    let guess = interpolate
      ? lo.block + Math.floor(((target - lo.timestamp) * (hi.block - lo.block)) / Math.max(1, hi.timestamp - lo.timestamp))
      : lo.block + Math.floor((hi.block - lo.block) / 2);
    guess = Math.min(hi.block - 1, Math.max(lo.block + 1, guess));
    const timestamp = await timeOf(guess);
    if (timestamp < target) lo = { block: guess, timestamp };
    else hi = { block: guess, timestamp };
    interpolate = !interpolate;
  }
  return lo;
}

/** A subscribed position as it stood at a block. */
export type PositionAt = { tokenId: string; poolIdPrefix: string; tickLower: number; tickUpper: number; liquidity: bigint; subscribed: boolean };

const signed24 = (raw: bigint) => {
  const value = Number(raw & 0xffffffn);
  return value >= 0x800000 ? value - 0x1000000 : value;
};

/** PositionInfo packs the pool id's first 25 bytes above the ticks: `poolId | tickUpper | tickLower | hasSubscriber`. */
export function unpackPositionInfo(info: bigint): { poolIdPrefix: string; tickLower: number; tickUpper: number } {
  return {
    poolIdPrefix: `0x${(info >> 56n).toString(16).padStart(50, "0")}`,
    tickLower: signed24(info >> 8n),
    tickUpper: signed24(info >> 32n),
  };
}

type Result = { success: boolean; returnData: Hex };

/** Each position's pool, range, liquidity and subscriber at `block`, in Multicall3 batches. A position that reverts (burned) is skipped. */
export async function readPositionsAt(client: RpcRequester, config: ChainConfig, tokenIds: readonly string[], block: number): Promise<PositionAt[]> {
  const positions: PositionAt[] = [];
  const target = config.contracts.positionManager;
  for (let i = 0; i < tokenIds.length; i += POSITIONS_PER_CALL) {
    const batch = tokenIds.slice(i, i + POSITIONS_PER_CALL);
    const calls = batch.flatMap(id =>
      (["positionInfo", "getPositionLiquidity", "subscriber"] as const).map(functionName => ({
        target,
        allowFailure: true,
        callData: encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName, args: [BigInt(id)] }),
      })),
    );
    const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [calls] });
    const raw = (await client.request({ method: "eth_call", params: [{ to: config.contracts.multicall3, data }, toHex(block)] })) as Hex;
    const results = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw }) as readonly Result[];
    batch.forEach((tokenId, j) => {
      const [info, liquidity, subscriber] = results.slice(3 * j, 3 * j + 3);
      if (!info?.success || !liquidity?.success || !subscriber?.success) return;
      try {
        const packed = decodeFunctionResult({ abi: POSITION_MANAGER_ABI, functionName: "positionInfo", data: info.returnData });
        const amount = decodeFunctionResult({ abi: POSITION_MANAGER_ABI, functionName: "getPositionLiquidity", data: liquidity.returnData });
        const holder = decodeFunctionResult({ abi: POSITION_MANAGER_ABI, functionName: "subscriber", data: subscriber.returnData });
        positions.push({ tokenId, ...unpackPositionInfo(packed), liquidity: amount, subscribed: holder.toLowerCase() === MERKL_TELX_SUBSCRIBER.toLowerCase() });
      } catch {
        // A result that doesn't decode is treated like a reverted call.
      }
    });
  }
  return positions;
}

/** One chain's state at a day's closing block: each pool's SVL and the token prices. */
export type DaySample = {
  day: number;
  block: number;
  /** USD per token, by lowercase address. */
  prices: Record<string, number>;
  /** Subscribed value per pool id, or null when the pool's price or a token price was missing. */
  svlUSD: Record<string, number | null>;
  /** Subscribed value per pool id including out-of-range positions, for comparison with Merkl's figures. */
  svlAllUSD: Record<string, number | null>;
  warnings: string[];
};

/** Values the subscribed positions of each pool at the snapshot's prices. */
export function valueSubscribed(
  config: ChainConfig,
  pools: readonly RpcPool[],
  snapshot: Pick<ChainSnapshot, "pools">,
  prices: Readonly<Record<string, number>>,
  positions: readonly PositionAt[],
): { inRange: Record<string, number | null>; all: Record<string, number | null> } {
  const inRange: Record<string, number | null> = {};
  const all: Record<string, number | null> = {};
  for (const pool of pools) {
    const slot0 = snapshot.pools[pool.id]?.slot0;
    const [t0, t1] = [config.tokens[pool.key.currency0], config.tokens[pool.key.currency1]];
    const [p0, p1] = [prices[pool.key.currency0], prices[pool.key.currency1]];
    if (!slot0 || !t0 || !t1 || !(p0 > 0) || !(p1 > 0)) {
      inRange[pool.id] = all[pool.id] = null;
      continue;
    }
    const prefix = pool.id.toLowerCase().slice(0, 52);
    let sumInRange = 0;
    let sumAll = 0;
    for (const position of positions) {
      if (!position.subscribed || position.liquidity <= 0n || position.poolIdPrefix !== prefix) continue;
      const { amount0, amount1 } = getAmountsForLiquidity(
        slot0.sqrtPriceX96,
        getSqrtPriceAtTick(position.tickLower),
        getSqrtPriceAtTick(position.tickUpper),
        position.liquidity,
      );
      const usd = toUnits(amount0, t0.decimals) * p0 + toUnits(amount1, t1.decimals) * p1;
      sumAll += usd;
      if (position.tickLower <= slot0.tick && slot0.tick < position.tickUpper) sumInRange += usd;
    }
    inRange[pool.id] = sumInRange;
    all[pool.id] = sumAll;
  }
  return { inRange, all };
}

/** Reads one chain at `block` and values its subscribed positions. `last` carries the previous day's prices. */
export async function sampleDay(
  client: RpcRequester,
  config: ChainConfig,
  pools: readonly RpcPool[],
  tokenIds: readonly string[],
  day: number,
  block: number,
  last: Readonly<Record<string, number>>,
  merklTel: number | null,
): Promise<DaySample> {
  const [snapshot, positions] = await Promise.all([readChainSnapshot(client, config, pools, block), readPositionsAt(client, config, tokenIds, block)]);
  const reserves = Object.fromEntries(pools.map(pool => [pool.id, snapshot.pools[pool.id]?.reserves ?? null]));
  // The previous day's TEL price stays out of `last`: pricing clamps a move against it as if it were the previous
  // 5-minute run, and TEL can move further than that in a day.
  const { [TEL]: _lastTel, ...lastWithoutTel } = last;
  const priced = priceChain({ config, pools, snapshot, reserves, last: lastWithoutTel, polygonTel: null, merklTel });
  const prices = Object.fromEntries(Object.entries(priced.tokens).map(([address, price]) => [address, price.usd]));
  const value = valueSubscribed(config, pools, snapshot, prices, positions);
  return { day, block, prices, svlUSD: SVL_IN_RANGE_ONLY ? value.inRange : value.all, svlAllUSD: value.all, warnings: priced.warnings };
}

/** TEL in every form a campaign has paid it in, priced as TEL. */
const TEL_ADDRESSES = new Set([TEL]);

/** A reward token's USD price on the sampled day: TEL from the day's pools, anything else at Merkl's current price. */
function rewardPrice(campaign: Campaign, sample: Pick<DaySample, "prices">): number | null {
  if (TEL_ADDRESSES.has(campaign.token) || campaign.symbol.toUpperCase() === "TEL") return sample.prices[TEL] ?? campaign.priceUSD;
  return sample.prices[campaign.token] ?? campaign.priceUSD;
}

export type ChainRewardsRow = RewardsDayRow & { source: typeof CHAIN_SOURCE };

/** The day's row for each pool with a campaign distributing during it. */
export function rewardsRowsForDay(campaigns: readonly Campaign[], sample: Pick<DaySample, "day" | "prices" | "svlUSD">, at: number): Map<string, ChainRewardsRow> {
  const rows = new Map<string, ChainRewardsRow>();
  const byPool = new Map<string, Campaign[]>();
  for (const campaign of campaignsOnDay(campaigns, sample.day)) byPool.set(campaign.poolId, [...(byPool.get(campaign.poolId) ?? []), campaign]);
  for (const [poolId, live] of byPool) {
    // `dailyRewards` is what the day distributed, so a campaign's partial first and last days count in part. The
    // APR uses the full-day rate of the campaigns live that day, as Merkl's does, so a partial day doesn't read
    // as a drop in APR.
    let dailyRewards: number | null = 0;
    let rate: number | null = 0;
    for (const campaign of live) {
      const price = rewardPrice(campaign, sample);
      dailyRewards = price === null || dailyRewards === null ? null : dailyRewards + campaign.amount * campaignShareOfDay(campaign, sample.day) * price;
      rate = price === null || rate === null ? null : rate + ((campaign.amount * DAY) / (campaign.end - campaign.start)) * price;
    }
    const svl = sample.svlUSD[poolId] ?? null;
    rows.set(poolId, {
      status: "LIVE",
      apr: rate !== null && svl !== null && svl > 0 ? (rate / svl) * 365 * 100 : null,
      dailyRewards,
      subscribedTvlUSD: svl,
      campaignIds: live.map(campaign => campaign.id),
      campaignStart: Math.min(...live.map(campaign => campaign.start)) * 1000,
      campaignEnd: Math.max(...live.map(campaign => campaign.end)) * 1000,
      pending: false,
      at,
      source: CHAIN_SOURCE,
    });
  }
  return rows;
}

/**
 * Sets each field unless the hash already holds a row that isn't a chain row, atomically, so a row the cron
 * recorded in between is never replaced. Returns how many fields it wrote.
 */
export const WRITE_UNLESS_RECORDED = `
local written = 0
for i = 1, #ARGV, 2 do
  local current = redis.call('HGET', KEYS[1], ARGV[i])
  if (not current) or string.find(current, '"source":"chain"', 1, true) then
    redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
    written = written + 1
  end
end
return written
`;

export type RewardsWriteRedis = { eval(script: string, keys: string[], args: string[]): Promise<unknown> };

/** Writes chain rows for one pool, keyed by day, without replacing recorded rows. */
export async function writeChainRows(redis: RewardsWriteRedis, chain: RpcChain, poolId: string, rows: ReadonlyMap<number, ChainRewardsRow>): Promise<number> {
  if (rows.size === 0) return 0;
  const args = [...rows].flatMap(([day, row]) => [String(day), JSON.stringify(row)]);
  return Number(await redis.eval(WRITE_UNLESS_RECORDED, [rewardsDayKey(chain, poolId)], args));
}

/** The UTC days from the first campaign's start through `today`, oldest first. */
export function backfillDays(campaigns: readonly Campaign[], today: number): number[] {
  if (campaigns.length === 0) return [];
  const days: number[] = [];
  for (let day = dayStart(Math.min(...campaigns.map(campaign => campaign.start))); day <= today; day += DAY) days.push(day);
  return days;
}

