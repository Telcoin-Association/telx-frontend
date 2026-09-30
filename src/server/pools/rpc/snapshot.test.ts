/**
 * @jest-environment node
 */
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";

import { rpcPoolsFor } from "../registry";
import { CHAINLINK_FEED_ABI, MULTICALL3_ABI, RESERVES_LENS_ABI, STATE_VIEW_ABI } from "./abi";
import { CHAINS } from "./chains";
import { buildBundle, readChainSnapshot } from "./snapshot";

const config = CHAINS.polygon;
const pools = rpcPoolsFor("polygon");
const ok = (returnData: Hex) => ({ success: true, returnData });
const failed = { success: false, returnData: "0x" as Hex };

const lensResult = (amount0: bigint, amount1: bigint) =>
  encodeFunctionResult({
    abi: RESERVES_LENS_ABI,
    functionName: "getPoolTVL",
    result: {
      coreAmount0: amount0,
      coreAmount1: amount1,
      hookReserves0: 0n,
      hookReserves1: 0n,
      hookEffective0: 0n,
      hookEffective1: 0n,
      sqrtPriceX96: 2n ** 96n,
      tick: 0,
      activeLiquidity: 1n,
      blockNumber: 5n,
      statsProvider: "0x0000000000000000000000000000000000000000",
      hookPermissions: 0,
      hasCustomAccounting: false,
      statsStatus: 0,
    },
  });

/** Results for the Polygon bundle: block 5 at time 1,000, both feeds, and every pool with the lens failing on the first. */
function results() {
  const feed = (answer: bigint) =>
    ok(encodeFunctionResult({ abi: CHAINLINK_FEED_ABI, functionName: "latestRoundData", result: [1n, answer, 0n, 990n, 1n] }));
  const out = [
    ok(encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getBlockNumber", result: 5n })),
    ok(encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp", result: 1_000n })),
    feed(2000n * 10n ** 8n),
    feed(5n * 10n ** 6n),
  ];
  pools.forEach((_pool, i) => {
    out.push(
      i === 0 ? failed : ok(lensResult(BigInt(i), BigInt(10 * i))),
      ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getSlot0", result: [2n ** 96n, 0, 2_048_500, 3000] })),
      ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getLiquidity", result: 7n })),
    );
  });
  return out;
}

describe("the bundle", () => {
  it("asks for the block, the time, each feed and three reads per pool, every sub-call allowed to fail but the first two", () => {
    const { calls } = buildBundle(config, pools);
    expect(calls).toHaveLength(2 + 2 + 3 * pools.length);
    expect(calls.map(call => call.allowFailure)).toEqual([false, false, ...Array(calls.length - 2).fill(true)]);
    expect(calls[4].target).toBe(config.contracts.reservesLens);
  });

  it("decodes each result, and a failed lens sub-call to null", () => {
    const snapshot = buildBundle(config, pools).decode(results());

    expect(snapshot.block).toBe(5);
    expect(snapshot.timestamp).toBe(1_000);
    expect(snapshot.feeds["ETH/USD"]).toEqual({ answer: 2000n * 10n ** 8n, updatedAt: 990 });
    expect(snapshot.pools[pools[0].id]).toEqual({
      reserves: null,
      slot0: { sqrtPriceX96: 2n ** 96n, tick: 0, protocolFee: 2_048_500, lpFee: 3000 },
      liquidity: 7n,
    });
    expect(snapshot.pools[pools[1].id].reserves).toEqual({ amount0: 1n, amount1: 10n });
  });

  it("decodes a failed feed to null and an uninitialized pool's slot0 to null", () => {
    const out = results();
    out[2] = failed;
    out[5] = ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getSlot0", result: [0n, 0, 0, 0] }));
    const snapshot = buildBundle(config, pools).decode(out);
    expect(snapshot.feeds["ETH/USD"]).toBeNull();
    expect(snapshot.pools[pools[0].id].slot0).toBeNull();
  });

  it("throws when the block number or time is missing, or the result count is off", () => {
    const { decode } = buildBundle(config, pools);
    const out = results();
    out[0] = failed;
    expect(() => decode(out)).toThrow("block number and time");
    expect(() => decode(results().slice(1))).toThrow("results for");
  });

  it("is one eth_call to Multicall3 at a block tag or a block number", async () => {
    const request = jest.fn(async () => encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results() }));
    await readChainSnapshot({ request }, config, pools, "finalized");
    await readChainSnapshot({ request }, config, pools, 255);
    await readChainSnapshot({ request }, config, pools, "safe");

    const [[first], [second]] = request.mock.calls as unknown as [{ params: [{ to: string; data: Hex }, string] }][];
    expect(first.params[0].to).toBe(config.contracts.multicall3);
    expect(first.params[1]).toBe("finalized");
    expect(second.params[1]).toBe("0xff");
    expect((request.mock.calls[2] as unknown as [{ params: [unknown, string] }])[0].params[1]).toBe("safe");
    expect(decodeFunctionData({ abi: MULTICALL3_ABI, data: first.params[0].data }).functionName).toBe("aggregate3");
  });
});
