import "server-only";

import { decodeFunctionResult, encodeAbiParameters, pad, parseAbiParameters, toHex, type Hex } from "viem";

import type { RawLog } from "@/server/chain/logs";

import { MODIFY_LIQUIDITY_TOPIC, MULTICALL3_ABI, SWAP_TOPIC } from "./abi";

/**
 * Test support: the recorded Polygon golden fixture (src/server/pools/__fixtures__/rpc/polygon-2026-09-28.json)
 * turned back into raw logs and the bundle's results. The fixture stores each log's decoded values to stay
 * small; the sender and salt, which the pipeline does not read, are zero.
 */

export type GoldenFixture = {
  chain: "polygon";
  fromBlock: number;
  toBlock: number;
  fromTime: number;
  poolIds: string[];
  bundle: Hex;
  logs: (string | number)[][];
};

const ZERO_WORD = pad("0x", { size: 32 });

export function fixtureRawLogs(fixture: GoldenFixture, poolManager: Hex): RawLog[] {
  return fixture.logs.map(row => {
    const [block, ts, logIndex, poolIndex, kind, ...values] = row as [number, number, number, number, string, ...(string | number)[]];
    const poolId = fixture.poolIds[poolIndex] as Hex;
    const data =
      kind === "swap"
        ? encodeAbiParameters(parseAbiParameters("int128, int128, uint160, uint128, int24, uint24"), [
            BigInt(values[0]),
            BigInt(values[1]),
            BigInt(values[2]),
            BigInt(values[3]),
            Number(values[4]),
            Number(values[5]),
          ])
        : encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [
            Number(values[0]),
            Number(values[1]),
            BigInt(values[2]),
            ZERO_WORD,
          ]);
    return {
      address: poolManager,
      blockNumber: toHex(block),
      blockHash: ZERO_WORD,
      blockTimestamp: toHex(ts),
      transactionHash: pad(toHex(block * 10_000 + logIndex), { size: 32 }),
      logIndex: toHex(logIndex),
      data,
      topics: [kind === "swap" ? SWAP_TOPIC : MODIFY_LIQUIDITY_TOPIC, poolId, ZERO_WORD],
      removed: false,
    };
  });
}

export function fixtureBundleResults(fixture: GoldenFixture) {
  return decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: fixture.bundle });
}
