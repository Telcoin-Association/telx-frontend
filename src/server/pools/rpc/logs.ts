import "server-only";

import { decodeEventLog, type Hex } from "viem";

import { readLogChunks, type ChainLog, type RpcRequester } from "@/server/chain/logs";

import { MODIFY_LIQUIDITY_TOPIC, POOL_MANAGER_EVENTS, SWAP_TOPIC } from "./abi";

/**
 * The PoolManager events of the registry pools over one block range: fetched with one filter, validated,
 * decoded and timed.
 *
 * Sign convention (v4-core `Pool.swap` and `PoolManager._swap`): the Swap amounts are the swapper's balance
 * deltas. A negative amount is what the swapper paid into the pool (the input, fee included) and a positive
 * amount is what it received. Uniswap v3's Swap event uses the opposite sign.
 */

type EventBase = { poolId: string; block: number; logIndex: number; timestamp: number };

export type SwapEvent = EventBase & {
  kind: "swap";
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  /** Whole swap fee in pips (hundredths of a bip): LP fee plus protocol fee. */
  fee: number;
};

export type LiquidityEvent = EventBase & {
  kind: "liquidity";
  tickLower: number;
  tickUpper: number;
  liquidityDelta: bigint;
  /** The contract that modified the position; the PositionManager for NFT positions. Lowercase. */
  sender: string;
  /** The position's salt; the PositionManager sets it to the token id. */
  salt: Hex;
};

export type PoolEvent = SwapEvent | LiquidityEvent;

export type LogRange = {
  fromBlock: number;
  toBlock: number;
  /** Times of the block before `fromBlock` and of `toBlock`, for logs without `blockTimestamp`. */
  fromTime: number;
  toTime: number;
};

/**
 * Checks that every log is one the filter asked for. A node that answers with another address, topic or pool,
 * a block outside the range, or a removed log is not trusted for any of the range, so the whole read fails.
 */
export function validateLogs(
  logs: readonly ChainLog[],
  poolManager: string,
  poolIds: ReadonlySet<string>,
  range: Pick<LogRange, "fromBlock" | "toBlock">,
) {
  for (const log of logs) {
    const where = `log ${log.transactionHash}:${log.logIndex}`;
    if (log.removed) throw new Error(`${where} is removed`);
    if (log.address.toLowerCase() !== poolManager.toLowerCase()) throw new Error(`${where} is from ${log.address}, not the PoolManager`);
    const topic = log.topics[0]?.toLowerCase();
    if (topic !== SWAP_TOPIC && topic !== MODIFY_LIQUIDITY_TOPIC) throw new Error(`${where} has topic ${topic}`);
    const poolId = log.topics[1]?.toLowerCase();
    if (!poolId || !poolIds.has(poolId)) throw new Error(`${where} is for pool ${poolId}`);
    if (log.blockNumber < range.fromBlock || log.blockNumber > range.toBlock)
      throw new Error(`${where} is at block ${log.blockNumber}, outside the range`);
  }
}

/**
 * Time of a log: its `blockTimestamp` when the node sends one, else interpolated between the block before the
 * range and the range's last block.
 */
export function timeOf(log: Pick<ChainLog, "blockNumber" | "blockTimestamp">, range: LogRange): number {
  if (log.blockTimestamp !== null) return log.blockTimestamp;
  const span = range.toBlock - (range.fromBlock - 1);
  if (span <= 0) return range.toTime;
  return Math.round(range.fromTime + ((log.blockNumber - (range.fromBlock - 1)) * (range.toTime - range.fromTime)) / span);
}

export function decodeLog(log: ChainLog, timestamp: number): PoolEvent {
  const decoded = decodeEventLog({ abi: POOL_MANAGER_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
  const base = { poolId: (decoded.args.id as string).toLowerCase(), block: log.blockNumber, logIndex: log.logIndex, timestamp };
  if (decoded.eventName === "Swap") {
    const { amount0, amount1, sqrtPriceX96, fee } = decoded.args;
    return { ...base, kind: "swap", amount0, amount1, sqrtPriceX96, fee };
  }
  const { tickLower, tickUpper, liquidityDelta, sender, salt } = decoded.args;
  return { ...base, kind: "liquidity", tickLower, tickUpper, liquidityDelta, sender: sender.toLowerCase(), salt };
}

/**
 * Swap and ModifyLiquidity events of `poolIds` in the range, sorted by block and log index. One getLogs call
 * normally covers the range; if the node refuses it for size, the range is read in smaller chunks.
 */
export async function fetchPoolEvents(
  client: RpcRequester,
  poolManager: Hex,
  poolIds: readonly string[],
  range: LogRange,
): Promise<{ events: PoolEvent[]; calls: number }> {
  const filter = { address: poolManager, topics: [[SWAP_TOPIC, MODIFY_LIQUIDITY_TOPIC], poolIds as Hex[]] };
  const ids = new Set(poolIds.map(id => id.toLowerCase()));
  const events: PoolEvent[] = [];
  let calls = 0;
  const seen = new Set<string>();
  for await (const chunk of readLogChunks(client, filter, range.fromBlock, range.toBlock, { maxSpan: range.toBlock - range.fromBlock + 1 })) {
    calls++;
    // Each chunk is checked against the range it asked for, and a log is counted once even if a node returns
    // it twice.
    validateLogs(chunk.logs, poolManager, ids, chunk);
    for (const log of chunk.logs) {
      const id = `${log.blockNumber}:${log.logIndex}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push(decodeLog(log, timeOf(log, range)));
    }
  }
  return { events, calls };
}
