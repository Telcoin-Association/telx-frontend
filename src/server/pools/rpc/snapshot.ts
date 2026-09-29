import "server-only";

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

import { toHex, type RpcRequester } from "@/server/chain/logs";

import { CHAINLINK_FEED_ABI, MULTICALL3_ABI, RESERVES_LENS_ABI, STATE_VIEW_ABI } from "./abi";
import type { ChainConfig, FeedName } from "./chains";
import type { RpcPool } from "../registry";

/**
 * Everything a run reads besides the logs, in one Multicall3 `aggregate3` eth_call: the block number and
 * time, each Chainlink feed's latest round, and per pool the ReservesLens reserves, StateView slot0 and
 * active liquidity. Every sub-call may fail on its own; a failed one decodes to null.
 */

export type FeedRound = { answer: bigint; updatedAt: number };

export type Slot0 = { sqrtPriceX96: bigint; tick: number; protocolFee: number; lpFee: number };

export type PoolSnapshot = {
  /** Core token amounts from ReservesLens; null when the lens call failed. */
  reserves: { amount0: bigint; amount1: bigint } | null;
  slot0: Slot0 | null;
  liquidity: bigint | null;
};

export type ChainSnapshot = {
  block: number;
  timestamp: number;
  feeds: Partial<Record<FeedName, FeedRound | null>>;
  pools: Record<string, PoolSnapshot>;
};

type Call = { target: Hex; allowFailure: boolean; callData: Hex };
type Result = { success: boolean; returnData: Hex };

/** The bundle's sub-calls and a decoder for their results, in the same order. */
export function buildBundle(config: ChainConfig, pools: readonly RpcPool[]) {
  const { multicall3, reservesLens, stateView, poolManager } = config.contracts;
  const feeds = Object.entries(config.feeds) as [FeedName, { address: Hex }][];

  const calls: Call[] = [
    { target: multicall3, allowFailure: false, callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "getBlockNumber" }) },
    { target: multicall3, allowFailure: false, callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp" }) },
    ...feeds.map(([, feed]) => ({
      target: feed.address,
      allowFailure: true,
      callData: encodeFunctionData({ abi: CHAINLINK_FEED_ABI, functionName: "latestRoundData" }),
    })),
  ];
  for (const pool of pools) {
    calls.push(
      {
        target: reservesLens,
        allowFailure: true,
        callData: encodeFunctionData({ abi: RESERVES_LENS_ABI, functionName: "getPoolTVL", args: [poolManager, pool.key] }),
      },
      {
        target: stateView,
        allowFailure: true,
        callData: encodeFunctionData({ abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [pool.id as Hex] }),
      },
      {
        target: stateView,
        allowFailure: true,
        callData: encodeFunctionData({ abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [pool.id as Hex] }),
      },
    );
  }

  function decodeOrNull<T>(result: Result | undefined, decode: (data: Hex) => T): T | null {
    if (!result?.success || !result.returnData || result.returnData === "0x") return null;
    try {
      return decode(result.returnData);
    } catch {
      return null;
    }
  }

  function decode(results: readonly Result[]): ChainSnapshot {
    if (results.length !== calls.length) throw new Error(`bundle returned ${results.length} results for ${calls.length} calls`);
    const block = decodeOrNull(results[0], data => decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getBlockNumber", data }));
    const timestamp = decodeOrNull(results[1], data => decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp", data }));
    if (block === null || timestamp === null) throw new Error("bundle did not return the block number and time");

    const snapshot: ChainSnapshot = { block: Number(block), timestamp: Number(timestamp), feeds: {}, pools: {} };
    feeds.forEach(([name], i) => {
      snapshot.feeds[name] = decodeOrNull(results[2 + i], data => {
        const [, answer, , updatedAt] = decodeFunctionResult({ abi: CHAINLINK_FEED_ABI, functionName: "latestRoundData", data });
        return { answer, updatedAt: Number(updatedAt) };
      });
    });
    const offset = 2 + feeds.length;
    pools.forEach((pool, i) => {
      const [lens, slot0, liquidity] = results.slice(offset + 3 * i, offset + 3 * i + 3);
      snapshot.pools[pool.id] = {
        reserves: decodeOrNull(lens, data => {
          const tvl = decodeFunctionResult({ abi: RESERVES_LENS_ABI, functionName: "getPoolTVL", data });
          return { amount0: tvl.coreAmount0, amount1: tvl.coreAmount1 };
        }),
        slot0: decodeOrNull(slot0, data => {
          const [sqrtPriceX96, tick, protocolFee, lpFee] = decodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getSlot0", data });
          return sqrtPriceX96 > 0n ? { sqrtPriceX96, tick, protocolFee, lpFee } : null;
        }),
        liquidity: decodeOrNull(liquidity, data => decodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getLiquidity", data })),
      };
    });
    return snapshot;
  }

  return { calls, decode };
}

/** Reads the bundle at `block`: a block number (archive read) or the `finalized` tag. */
export async function readChainSnapshot(
  client: RpcRequester,
  config: ChainConfig,
  pools: readonly RpcPool[],
  block: number | "finalized",
): Promise<ChainSnapshot> {
  const { calls, decode } = buildBundle(config, pools);
  const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [calls] });
  const tag = block === "finalized" ? block : toHex(block);
  const raw = (await client.request({ method: "eth_call", params: [{ to: config.contracts.multicall3, data }, tag] })) as Hex;
  return decode(decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw }));
}
