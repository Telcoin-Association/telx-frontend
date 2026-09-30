import "server-only";

import { decodeEventLog, pad, parseAbi, toHex, type Address, type Hex } from "viem";

import { decodePositionInfo, positionManagerAbi } from "@/app/api/backendHelpers/helpers";
import type { RpcChain } from "@/lib/rpc";
import { readLogChunks, type RpcRequester } from "@/server/chain/logs";
import { MODIFY_LIQUIDITY_TOPIC, POOL_MANAGER_EVENTS, STATE_VIEW_ABI } from "@/server/pools/rpc/abi";
import { DAY, DAY_ROWS, dayStart, type DayRow } from "@/server/pools/rpc/buckets";
import { getAmountsForLiquidity, getSqrtPriceAtTick, priceOfToken0InToken1, toUnits } from "@/server/pools/rpc/liquidityMath";
import { dayKey, readCursor, readPositionChanges, readState, type RpcRedis } from "@/server/pools/rpc/store";
import { chainConfig, rpcPoolsFor, type RpcPool } from "@/server/pools/registry";

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
 */

const FEE_ABI = parseAbi([
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)",
]);

const Q128 = 2n ** 128n;
const MAX_UINT256 = 2n ** 256n;

/** Most archive price reads one request makes: the deposits and withdrawals, and the days without a stored price. */
export const MAX_ARCHIVE_READS = 40;

export type HistoryClient = RpcRequester & {
  multicall(args: { contracts: readonly unknown[]; allowFailure: true }): Promise<({ status: "success"; result: unknown } | { status: "failure"; error: Error })[]>;
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
};

export type HistoryDeps = { client: HistoryClient; redis: RpcRedis; positionManager: Address; now?: () => number };

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

  const [info, liquidityNow] = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: positionManager, abi: positionManagerAbi, functionName: "positionInfo", args: [tokenId] },
      { address: positionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] },
    ],
  });
  if (info?.status !== "success" || liquidityNow?.status !== "success") return null;
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
    notes.push("The chain logs could not be read, so the liquidity history covers only the changes the pipeline has recorded.");
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

  const netLiquidity = changes.reduce((sum, change) => sum + change.d, 0n);
  const complete = netLiquidity === (liquidityNow.result as bigint);
  if (!complete) notes.push("The recorded liquidity changes don't add up to the position's current liquidity, so its history is incomplete.");

  // Net deposits, each change valued at the pool price in its own block.
  let deposited: { amount0: number; amount1: number } | null = complete ? { amount0: 0, amount1: 0 } : null;
  for (const change of complete ? changes : []) {
    if (change.d === 0n) continue;
    const sqrt = await archiveSqrt(change.block);
    if (sqrt === null) {
      deposited = null;
      notes.push("The price at one of the position's deposits or withdrawals could not be read, so the held-instead line is left out.");
      break;
    }
    const size = change.d < 0n ? -change.d : change.d;
    const { amount0, amount1 } = getAmountsForLiquidity(sqrt, sqrtLower, sqrtUpper, size);
    const sign = change.d < 0n ? -1 : 1;
    deposited = { amount0: deposited!.amount0 + sign * toUnits(amount0, d0), amount1: deposited!.amount1 + sign * toUnits(amount1, d1) };
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
    notes.push("Days before the pipeline stored daily prices use an archive read of the pool price and the latest token prices.");
  }
  if (firstChange && dayStart(firstChange.t) < firstDay) {
    notes.push(`The position is older than the ${DAY_ROWS} days of pool history kept, so the chart starts on the first day kept.`);
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
    historyFrom: days.find(day => day.price !== null)?.day ?? null,
    changesFrom,
    notes,
  };
}
