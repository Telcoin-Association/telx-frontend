import "server-only";

import { decodeEventLog, pad, parseAbi, toHex, type Address, type Hex } from "viem";

import { decodePositionInfo, positionManagerAbi } from "@/app/api/backendHelpers/helpers";
import type { RpcChain } from "@/lib/rpc";
import { readLogChunks, type RpcRequester } from "@/server/chain/logs";
import { MODIFY_LIQUIDITY_TOPIC, POOL_MANAGER_EVENTS, STATE_VIEW_ABI } from "@/server/pools/rpc/abi";
import { DAY, DAY_ROWS, dayStart, type DayRow } from "@/server/pools/rpc/buckets";
import { getAmountsForLiquidity, getSqrtPriceAtTick, priceOfToken0InToken1, toUnits } from "@/server/pools/rpc/liquidityMath";
import { priceChain } from "@/server/pools/rpc/pricing";
import { readChainSnapshot } from "@/server/pools/rpc/snapshot";
import { dayKey, readCursor, readPositionChanges, readState, type RpcRedis } from "@/server/pools/rpc/store";
import { chainConfig, rpcPoolsFor, type RpcPool } from "@/server/pools/registry";
import type { PositionRewards } from "./rewards";

/**
 * The history of one Uniswap v4 position in a registry pool, for the position charts: its range, its liquidity
 * and value per UTC day, what its deposits would be worth had they been held instead, the days its range held
 * the price, and its uncollected fees now.
 *
 * Liquidity changes come from the PositionManager's ModifyLiquidity logs for the pool since its creation, with
 * the pipeline's stored changes (`rpc:<chain>:pos:<poolId>`) as the source when the log read fails. Each day is
 * priced with the pool's closing price and token USD prices from its day row; a day row written before those
 * fields existed is priced with an archive read of the pool's price near the day's end and the latest token
 * prices, and the day says so (`pricedWith: "latest"`).
 *
 * Each deposit and withdrawal is valued at the block it happened in: the pool's price there and token USD
 * prices from the pipeline's own pricing run against that block. Those give the money put in and taken out,
 * and each token's price when the position opened. `performance` sets them against the value now, the
 * uncollected fees and the TELx rewards the position has earned (see src/server/positions/rewards.ts).
 */

const FEE_ABI = parseAbi([
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)",
]);

const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

const Q128 = 2n ** 128n;
const MAX_UINT256 = 2n ** 256n;

/** Most archive price reads one request makes: the deposits and withdrawals, and the days without a stored price. */
export const MAX_ARCHIVE_READS = 40;

export type HistoryClient = RpcRequester & {
  multicall(args: { contracts: readonly unknown[]; allowFailure: true }): Promise<({ status: "success"; result: unknown } | { status: "failure"; error: Error })[]>;
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
};

export type HistoryDeps = {
  client: HistoryClient;
  redis: RpcRedis;
  positionManager: Address;
  now?: () => number;
  /** The TELx rewards the position has earned, read for its owner. Null when they can't be read. */
  rewards?: (owner: Address) => Promise<PositionRewards | null>;
  /** The pool's price and token USD prices at a block. Defaults to pricedAtBlock. */
  pricedAt?: (block: number) => Promise<BlockPrices | null>;
};

/** A pool's sqrt price and its two tokens' USD prices at one block; a token the pricing couldn't price is null. */
export type BlockPrices = { sqrt: bigint; usd0: number | null; usd1: number | null };

/**
 * The pool's price and both tokens' USD prices at `block`: one snapshot read of the chain's pools there, priced
 * the way the pipeline prices a run. A price the pipeline would only carry over from an earlier run counts as
 * unknown, since there is no earlier run to carry from.
 */
export async function pricedAtBlock(client: RpcRequester, chain: RpcChain, pool: RpcPool, block: number): Promise<BlockPrices | null> {
  const config = chainConfig(chain);
  const pools = rpcPoolsFor(chain);
  const snapshot = await readChainSnapshot(client, config, pools, block);
  const slot0 = snapshot.pools[pool.id]?.slot0;
  if (!slot0) return null;
  const reserves = Object.fromEntries(pools.map(candidate => [candidate.id, snapshot.pools[candidate.id]?.reserves ?? null]));
  const { tokens } = priceChain({ config, pools, snapshot, reserves, last: {}, polygonTel: null });
  const usd = (address: string) => {
    const price = tokens[address.toLowerCase()];
    return price && !price.stale ? price.usd : null;
  };
  return { sqrt: slot0.sqrtPriceX96, usd0: usd(pool.key.currency0), usd1: usd(pool.key.currency1) };
}

export type HistoryDay = {
  /** Start of the UTC day, unix seconds. */
  day: number;
  /** Liquidity at the day's end, as a decimal string. */
  liquidity: string;
  /** Pool price at the day's close: currency1 per currency0, in whole tokens. */
  price: number | null;
  tick: number | null;
  inRange: boolean | null;
  amount0: number | null;
  amount1: number | null;
  valueUSD: number | null;
  heldUSD: number | null;
  /** `stored`: the day row's closing price and USD prices. `latest`: an archive price read and the latest USD prices. */
  pricedWith: "stored" | "latest" | null;
};

/** A token's USD price when the position opened and now, and the change between them as a fraction. */
export type PriceChange = { open: number | null; now: number | null; change: number | null };

/**
 * How the position has done. Money figures are USD; `pnl` and `impermanentLoss` are fractions (0.05 is 5%).
 * A figure that needs a price or a read that failed is null.
 */
export type PositionPerformance = {
  /** When the first deposit was made, unix seconds. */
  openedAt: number | null;
  priceChange: { token0: PriceChange; token1: PriceChange };
  /** Every deposit, valued when it was made. */
  depositedUSD: number | null;
  /** Every withdrawal, valued when it was made. Fees collected with a withdrawal are not included. */
  withdrawnUSD: number | null;
  valueUSD: number | null;
  /** The net deposited tokens at today's prices. */
  heldUSD: number | null;
  /**
   * Value against holding the deposited tokens, before fees and rewards: valueUSD / heldUSD - 1. Only for liquidity
   * still in the pool: null once the position is closed, or when withdrawals took out more of a token than went in.
   */
  impermanentLoss: number | null;
  /** TEL earned from TELx campaigns, from Merkl, and its value at today's TEL price. */
  rewards: { amount: number; symbol: string; usd: number | null } | null;
  /** Uncollected fees plus rewards, each counted when known. */
  feesAndRewardsUSD: number | null;
  /** valueUSD + withdrawnUSD + uncollected fees + rewards - depositedUSD. */
  pnlUSD: number | null;
  /** pnlUSD / depositedUSD. */
  pnl: number | null;
};

export type PositionHistory = {
  chain: RpcChain;
  tokenId: string;
  poolId: string;
  currency0: { address: string; symbol: string; decimals: number };
  currency1: { address: string; symbol: string; decimals: number };
  tickLower: number;
  tickUpper: number;
  /** The range as prices, currency1 per currency0. */
  priceLower: number | null;
  priceUpper: number | null;
  liquidity: string;
  currentPrice: number | null;
  inRange: boolean | null;
  days: HistoryDay[];
  /** Days with liquidity and a known closing tick, and how many of them closed in range. */
  timeInRange: { days: number; inRangeDays: number };
  /** Net deposited amounts, each change valued at the price when it happened. Null when it could not be read. */
  deposited: { amount0: number; amount1: number } | null;
  fees: { amount0: number; amount1: number; usd: number | null } | null;
  performance: PositionPerformance;
  /** First day with a price, unix seconds, or null when no day could be priced. */
  historyFrom: number | null;
  /** Where the liquidity changes came from: the chain logs, or the pipeline's stored changes when the logs failed. */
  changesFrom: "logs" | "stored";
  notes: string[];
};

type Change = { block: number; logIndex: number; t: number; d: bigint };

const poolIdPrefix = (poolId: string) => poolId.toLowerCase().slice(0, 52);

async function readChangesFromLogs(client: RpcRequester, pool: RpcPool, poolManager: Address, positionManager: Address, tokenId: bigint, toBlock: number) {
  const filter = { address: poolManager, topics: [MODIFY_LIQUIDITY_TOPIC, pool.id as Hex, pad(positionManager, { size: 32 })] } as const;
  const changes: Change[] = [];
  const salt = pad(toHex(tokenId), { size: 32 }).toLowerCase();
  for await (const chunk of readLogChunks(client, filter as never, pool.createdBlock, toBlock, { maxSpan: toBlock - pool.createdBlock + 1 })) {
    for (const log of chunk.logs) {
      const decoded = decodeEventLog({ abi: POOL_MANAGER_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "ModifyLiquidity" || decoded.args.salt.toLowerCase() !== salt) continue;
      changes.push({ block: log.blockNumber, logIndex: log.logIndex, t: log.blockTimestamp ?? 0, d: decoded.args.liquidityDelta });
    }
  }
  return changes.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}

/** The block nearest `time` (unix seconds), estimated from a reference block and the chain's block time. */
const blockNear = (reference: { block: number; timestamp: number }, blockTime: number, time: number) =>
  Math.max(0, Math.min(reference.block, reference.block - Math.ceil((reference.timestamp - time) / blockTime)));

export async function positionHistory(chain: RpcChain, tokenId: bigint, deps: HistoryDeps): Promise<PositionHistory | null> {
  const { client, redis, positionManager } = deps;
  const now = Math.floor((deps.now ?? Date.now)() / 1000);
  const config = chainConfig(chain);
  const stateView = config.contracts.stateView;
  const notes: string[] = [];

  const [info, liquidityNow, ownerRead] = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: positionManager, abi: positionManagerAbi, functionName: "positionInfo", args: [tokenId] },
      { address: positionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] },
      { address: positionManager, abi: OWNER_ABI, functionName: "ownerOf", args: [tokenId] },
    ],
  });
  if (info?.status !== "success" || liquidityNow?.status !== "success") return null;
  const owner = ownerRead?.status === "success" ? (ownerRead.result as Address) : null;
  // Merkl is read alongside the chain reads below.
  const rewardsRead = owner && deps.rewards ? deps.rewards(owner).catch(() => null) : Promise.resolve(null);
  const word = info.result as bigint;
  const pool = rpcPoolsFor(chain).find(candidate => poolIdPrefix(candidate.id) === toHex(word, { size: 32 }).slice(0, 52));
  if (!pool) return null;
  const decoded = decodePositionInfo(word);
  const tickLower = decoded.getTickLower();
  const tickUpper = decoded.getTickUpper();
  const token0 = config.tokens[pool.key.currency0.toLowerCase()];
  const token1 = config.tokens[pool.key.currency1.toLowerCase()];
  const [d0, d1] = [token0.decimals, token1.decimals];
  const sqrtLower = getSqrtPriceAtTick(tickLower);
  const sqrtUpper = getSqrtPriceAtTick(tickUpper);
  const salt = pad(toHex(tokenId), { size: 32 });

  const [cursor, state, rawDays] = await Promise.all([readCursor(redis, chain), readState(redis, chain), redis.hgetall(dayKey(chain, pool.id))]);
  const head = cursor ?? { block: Number(await client.request({ method: "eth_blockNumber" })), timestamp: now };

  let changes: Change[];
  let changesFrom: "logs" | "stored" = "logs";
  try {
    changes = await readChangesFromLogs(client, pool, config.contracts.poolManager, positionManager, tokenId, head.block);
  } catch {
    changesFrom = "stored";
    notes.push("Some of this position's earlier history couldn't be loaded.");
    changes = (await readPositionChanges(redis, chain, pool.id, tokenId)).map(change => ({ ...change, d: BigInt(change.d) }));
  }
  // Logs without a block time are placed by the chain's block time from the reference block.
  for (const change of changes) if (!change.t) change.t = head.timestamp - (head.block - change.block) * config.blockTime;

  const [slot0Now, positionInfoNow, feeGrowthNow] = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [pool.id] },
      { address: stateView, abi: FEE_ABI, functionName: "getPositionInfo", args: [pool.id, positionManager, tickLower, tickUpper, salt] },
      { address: stateView, abi: FEE_ABI, functionName: "getFeeGrowthInside", args: [pool.id, tickLower, tickUpper] },
    ],
  });
  const currentSqrt = slot0Now?.status === "success" ? (slot0Now.result as readonly [bigint, number])[0] : null;
  const currentTick = slot0Now?.status === "success" ? Number((slot0Now.result as readonly [bigint, number])[1]) : null;

  const latestUsd = (address: string) => state.prices?.tokens[address.toLowerCase()]?.usd ?? null;
  const [latest0, latest1] = [latestUsd(pool.key.currency0), latestUsd(pool.key.currency1)];

  let archiveReads = 0;
  const archiveSqrt = async (block: number): Promise<bigint | null> => {
    if (archiveReads >= MAX_ARCHIVE_READS) return null;
    archiveReads++;
    try {
      const [sqrt] = (await client.readContract({ address: stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [pool.id], blockNumber: BigInt(block) })) as readonly [bigint];
      return sqrt;
    } catch {
      return null;
    }
  };

  const readPrices = deps.pricedAt ?? ((block: number) => pricedAtBlock(client, chain, pool, block));
  const pricedAt = async (block: number): Promise<BlockPrices | null> => {
    if (archiveReads >= MAX_ARCHIVE_READS) return null;
    archiveReads++;
    try {
      return await readPrices(block);
    } catch {
      return null;
    }
  };

  const netLiquidity = changes.reduce((sum, change) => sum + change.d, 0n);
  const complete = netLiquidity === (liquidityNow.result as bigint);
  if (!complete) notes.push("Part of this position's history is missing.");

  // Net deposits, and the money put in and taken out, each change valued at the prices in its own block.
  let deposited: { amount0: number; amount1: number } | null = complete ? { amount0: 0, amount1: 0 } : null;
  let depositedUSD: number | null = complete ? 0 : null;
  let withdrawnUSD: number | null = complete ? 0 : null;
  let opened: { at: number; usd0: number | null; usd1: number | null } | null = null;
  for (const change of complete ? changes : []) {
    if (change.d === 0n) continue;
    const priced = await pricedAt(change.block);
    const sqrt = priced?.sqrt ?? (await archiveSqrt(change.block));
    if (sqrt === null) {
      deposited = null;
      depositedUSD = withdrawnUSD = null;
      notes.push("The comparison with holding isn't available for this position.");
      break;
    }
    opened ??= { at: change.t, usd0: priced?.usd0 ?? null, usd1: priced?.usd1 ?? null };
    const size = change.d < 0n ? -change.d : change.d;
    const amounts = getAmountsForLiquidity(sqrt, sqrtLower, sqrtUpper, size);
    const [amount0, amount1] = [toUnits(amounts.amount0, d0), toUnits(amounts.amount1, d1)];
    const usd = priced && priced.usd0 !== null && priced.usd1 !== null ? amount0 * priced.usd0 + amount1 * priced.usd1 : null;
    const sign = change.d < 0n ? -1 : 1;
    if (sign > 0) depositedUSD = depositedUSD !== null && usd !== null ? depositedUSD + usd : null;
    else withdrawnUSD = withdrawnUSD !== null && usd !== null ? withdrawnUSD + usd : null;
    deposited = { amount0: deposited!.amount0 + sign * amount0, amount1: deposited!.amount1 + sign * amount1 };
  }

  const storedDays = new Map<number, DayRow>();
  for (const [field, value] of Object.entries(rawDays ?? {})) {
    const row = typeof value === "string" ? (JSON.parse(value) as DayRow) : (value as DayRow);
    if (row) storedDays.set(Number(field), row);
  }

  const today = dayStart(now);
  const firstChange = changes.find(change => change.d !== 0n);
  const firstDay = firstChange ? Math.max(dayStart(firstChange.t), today - (DAY_ROWS - 1) * DAY) : today;
  const days: HistoryDay[] = [];
  let changeIndex = 0;
  let liquidity = 0n;
  for (const change of changes) if (change.t < firstDay) liquidity += change.d;
  while (changeIndex < changes.length && changes[changeIndex].t < firstDay) changeIndex++;

  for (let day = firstDay; day <= today; day += DAY) {
    const close = Math.min(day + DAY - 1, now);
    while (changeIndex < changes.length && changes[changeIndex].t <= close) liquidity += changes[changeIndex++].d;
    const row = storedDays.get(day);
    let sqrt: bigint | null = row?.sqrtPriceX96 ? BigInt(row.sqrtPriceX96) : null;
    let tick: number | null = row?.tick ?? null;
    let usd0: number | null = row?.price0USD ?? null;
    let usd1: number | null = row?.price1USD ?? null;
    let pricedWith: HistoryDay["pricedWith"] = sqrt !== null && usd0 !== null && usd1 !== null ? "stored" : null;
    if (pricedWith === null) {
      sqrt = day === today && currentSqrt !== null ? currentSqrt : await archiveSqrt(blockNear(head, config.blockTime, close));
      tick = day === today && currentTick !== null ? currentTick : null;
      [usd0, usd1] = [latest0, latest1];
      pricedWith = sqrt !== null && usd0 !== null && usd1 !== null ? "latest" : null;
    }
    if (tick === null && sqrt !== null) tick = Math.floor(Math.log(Number(sqrt) / Number(2n ** 96n)) / Math.log(Math.sqrt(1.0001)));
    const price = sqrt !== null ? priceOfToken0InToken1(sqrt, d0, d1) : null;
    const amounts = sqrt !== null && liquidity > 0n ? getAmountsForLiquidity(sqrt, sqrtLower, sqrtUpper, liquidity) : null;
    const amount0 = amounts ? toUnits(amounts.amount0, d0) : sqrt !== null ? 0 : null;
    const amount1 = amounts ? toUnits(amounts.amount1, d1) : sqrt !== null ? 0 : null;
    const priced = pricedWith !== null && usd0 !== null && usd1 !== null;
    days.push({
      day,
      liquidity: liquidity.toString(),
      price,
      tick,
      inRange: tick === null ? null : tick >= tickLower && tick < tickUpper,
      amount0,
      amount1,
      valueUSD: priced && amount0 !== null && amount1 !== null ? amount0 * usd0! + amount1 * usd1! : null,
      heldUSD: priced && deposited ? Math.max(deposited.amount0, 0) * usd0! + Math.max(deposited.amount1, 0) * usd1! : null,
      pricedWith,
    });
  }
  if (days.some(day => day.pricedWith === "latest")) {
    notes.push("Earlier days are valued at today's token prices.");
  }
  if (firstChange && dayStart(firstChange.t) < firstDay) {
    notes.push(`History covers the last ${DAY_ROWS} days.`);
  }

  const withLiquidity = days.filter(day => BigInt(day.liquidity) > 0n && day.inRange !== null);
  let fees: PositionHistory["fees"] = null;
  if (positionInfoNow?.status === "success" && feeGrowthNow?.status === "success") {
    const [positionLiquidity, last0, last1] = positionInfoNow.result as readonly [bigint, bigint, bigint];
    const [inside0, inside1] = feeGrowthNow.result as readonly [bigint, bigint];
    const owed = (inside: bigint, last: bigint) => (((inside - last) % MAX_UINT256) + MAX_UINT256) % MAX_UINT256 * positionLiquidity / Q128;
    const amount0 = toUnits(owed(inside0, last0), d0);
    const amount1 = toUnits(owed(inside1, last1), d1);
    fees = { amount0, amount1, usd: latest0 !== null && latest1 !== null ? amount0 * latest0 + amount1 * latest1 : null };
  }

  const latestDay = [...days].reverse().find(day => day.valueUSD !== null);
  const valueUSD = latestDay?.valueUSD ?? null;
  const heldUSD = latestDay?.heldUSD ?? null;
  const earned = await rewardsRead;
  if (deps.rewards && owner && !earned) notes.push("TELx rewards couldn't be loaded, so they aren't counted.");
  const rewardPrice = earned ? ((earned.token ? latestUsd(earned.token) : null) ?? earned.priceUSD) : null;
  const rewards = earned ? { amount: earned.amount, symbol: earned.symbol, usd: rewardPrice !== null ? earned.amount * rewardPrice : null } : null;
  const feesAndRewardsUSD = fees?.usd != null || rewards?.usd != null ? (fees?.usd ?? 0) + (rewards?.usd ?? 0) : null;
  const pnlUSD =
    valueUSD !== null && depositedUSD !== null && withdrawnUSD !== null && depositedUSD > 0
      ? valueUSD + withdrawnUSD + (fees?.usd ?? 0) + (rewards?.usd ?? 0) - depositedUSD
      : null;
  const stillHeld = (liquidityNow.result as bigint) > 0n && deposited !== null && deposited.amount0 >= 0 && deposited.amount1 >= 0;
  const priceChange = (open: number | null, now: number | null): PriceChange => ({
    open,
    now,
    change: open !== null && now !== null && open > 0 ? now / open - 1 : null,
  });
  const performance: PositionPerformance = {
    openedAt: opened?.at ?? null,
    priceChange: { token0: priceChange(opened?.usd0 ?? null, latest0), token1: priceChange(opened?.usd1 ?? null, latest1) },
    depositedUSD,
    withdrawnUSD,
    valueUSD,
    heldUSD,
    impermanentLoss: stillHeld && valueUSD !== null && heldUSD !== null && heldUSD > 0 ? valueUSD / heldUSD - 1 : null,
    rewards,
    feesAndRewardsUSD,
    pnlUSD,
    pnl: pnlUSD !== null && depositedUSD ? pnlUSD / depositedUSD : null,
  };

  return {
    chain,
    tokenId: tokenId.toString(),
    poolId: pool.id,
    currency0: { address: pool.key.currency0, symbol: token0.symbol, decimals: d0 },
    currency1: { address: pool.key.currency1, symbol: token1.symbol, decimals: d1 },
    tickLower,
    tickUpper,
    priceLower: priceOfToken0InToken1(sqrtLower, d0, d1),
    priceUpper: priceOfToken0InToken1(sqrtUpper, d0, d1),
    liquidity: (liquidityNow.result as bigint).toString(),
    currentPrice: currentSqrt !== null ? priceOfToken0InToken1(currentSqrt, d0, d1) : null,
    inRange: currentTick === null ? null : currentTick >= tickLower && currentTick < tickUpper,
    days,
    timeInRange: { days: withLiquidity.length, inRangeDays: withLiquidity.filter(day => day.inRange).length },
    deposited,
    fees,
    performance,
    historyFrom: days.find(day => day.price !== null)?.day ?? null,
    changesFrom,
    notes,
  };
}
