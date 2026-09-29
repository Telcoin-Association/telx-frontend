/**
 * @jest-environment node
 */
import { encodeAbiParameters, pad, parseAbiParameters, toHex, type Hex } from "viem";

import type { ChainLog } from "@/server/chain/logs";

import { MODIFY_LIQUIDITY_TOPIC, SWAP_TOPIC } from "./abi";
import { decodeLog, fetchPoolEvents, timeOf, validateLogs } from "./logs";
import { swapInput } from "./swapMath";

const POOL_MANAGER = "0x67366782805870060151383f4bbff9dab53e5cd6";
const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const ZERO = pad("0x", { size: 32 });
const RANGE = { fromBlock: 101, toBlock: 200, fromTime: 1_000, toTime: 1_200 };

const swapData = (amount0: bigint, amount1: bigint) =>
  encodeAbiParameters(parseAbiParameters("int128, int128, uint160, uint128, int24, uint24"), [amount0, amount1, 2n ** 96n, 10n ** 18n, 0, 3499]);

function log(overrides: Partial<ChainLog> = {}): ChainLog {
  return {
    address: POOL_MANAGER,
    blockNumber: 150,
    blockHash: ZERO,
    blockTimestamp: 1_100,
    transactionHash: ZERO,
    logIndex: 0,
    data: swapData(-1000n, 990n),
    topics: [SWAP_TOPIC, POOL as Hex, ZERO],
    removed: false,
    ...overrides,
  };
}

describe("decodeLog", () => {
  it("decodes a Swap with v4's sign convention: the negative amount is what the swapper paid in", () => {
    const event = decodeLog(log(), 1_100);
    expect(event).toEqual({
      poolId: POOL,
      block: 150,
      logIndex: 0,
      timestamp: 1_100,
      kind: "swap",
      amount0: -1000n,
      amount1: 990n,
      sqrtPriceX96: 2n ** 96n,
      fee: 3499,
    });
    expect(event.kind === "swap" && swapInput(event)).toEqual({ currency: 0, amount: 1000n });
  });

  it("reads a swap signed the v3 way (positive into the pool) as the opposite direction", () => {
    const event = decodeLog(log({ data: swapData(1000n, -990n) }), 1_100);
    expect(event.kind === "swap" && swapInput(event)).toEqual({ currency: 1, amount: 990n });
  });

  it("decodes a ModifyLiquidity", () => {
    const data = encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [-120, 60, -5n, ZERO]);
    expect(decodeLog(log({ topics: [MODIFY_LIQUIDITY_TOPIC, POOL as Hex, ZERO], data }), 1_100)).toEqual({
      poolId: POOL,
      block: 150,
      logIndex: 0,
      timestamp: 1_100,
      kind: "liquidity",
      tickLower: -120,
      tickUpper: 60,
      liquidityDelta: -5n,
    });
  });
});

describe("validateLogs", () => {
  const check = (entry: ChainLog) => () => validateLogs([entry], POOL_MANAGER, new Set([POOL]), RANGE);

  it("accepts the logs the filter asked for, whatever the address case", () => {
    expect(check(log({ address: "0x67366782805870060151383F4BBFF9DAB53E5CD6" }))).not.toThrow();
  });

  it.each([
    ["a removed log", log({ removed: true }), "is removed"],
    ["another contract", log({ address: "0x0000000000000000000000000000000000000001" }), "not the PoolManager"],
    ["another event", log({ topics: [pad("0x01", { size: 32 }), POOL as Hex] }), "has topic"],
    ["another pool", log({ topics: [SWAP_TOPIC, pad("0x02", { size: 32 })] }), "is for pool"],
    ["a block before the range", log({ blockNumber: 100 }), "outside the range"],
    ["a block after the range", log({ blockNumber: 201 }), "outside the range"],
  ])("rejects %s", (_name, entry, message) => {
    expect(check(entry)).toThrow(message);
  });
});

describe("timeOf", () => {
  it("uses blockTimestamp when the node sends it", () => {
    expect(timeOf({ blockNumber: 150, blockTimestamp: 1_111 }, RANGE)).toBe(1_111);
  });

  it("interpolates between the block before the range and its last block otherwise", () => {
    expect(timeOf({ blockNumber: 150, blockTimestamp: null }, RANGE)).toBe(1_100);
    expect(timeOf({ blockNumber: 200, blockTimestamp: null }, RANGE)).toBe(1_200);
    expect(timeOf({ blockNumber: 101, blockTimestamp: null }, RANGE)).toBe(1_002);
  });
});

describe("fetchPoolEvents", () => {
  const rawOf = (entry: ChainLog) => ({ ...entry, blockNumber: toHex(entry.blockNumber), logIndex: toHex(entry.logIndex), blockTimestamp: null });

  it("asks for Swap and ModifyLiquidity of the pools over the range, and times logs without blockTimestamp", async () => {
    const request = jest.fn(async () => [rawOf(log({ blockNumber: 200, logIndex: 1 })), rawOf(log({ blockNumber: 150 }))]);

    const { events, calls } = await fetchPoolEvents({ request }, POOL_MANAGER, [POOL], RANGE);

    expect(calls).toBe(1);
    expect(request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [{ address: POOL_MANAGER, topics: [[SWAP_TOPIC, MODIFY_LIQUIDITY_TOPIC], [POOL]], fromBlock: "0x65", toBlock: "0xc8" }],
    });
    expect(events.map(event => [event.block, event.timestamp])).toEqual([
      [150, 1_100],
      [200, 1_200],
    ]);
  });

  it("counts a log returned twice once", async () => {
    const request = jest.fn(async () => [rawOf(log({ blockNumber: 150 })), rawOf(log({ blockNumber: 150 }))]);
    const { events } = await fetchPoolEvents({ request }, POOL_MANAGER, [POOL], RANGE);
    expect(events).toHaveLength(1);
  });

  it("checks each chunk against the range it asked for", async () => {
    // The first call is refused for size; the node then answers the first half with a log from the second half.
    const request = jest
      .fn()
      .mockRejectedValueOnce(new Error("block range too large"))
      .mockResolvedValueOnce([rawOf(log({ blockNumber: 190 }))]);
    await expect(fetchPoolEvents({ request }, POOL_MANAGER, [POOL], RANGE)).rejects.toThrow("outside the range");
  });

  it("fails the whole read on one foreign log", async () => {
    const request = jest.fn(async () => [rawOf(log()), rawOf(log({ address: "0x0000000000000000000000000000000000000001" }))]);
    await expect(fetchPoolEvents({ request }, POOL_MANAGER, [POOL], RANGE)).rejects.toThrow("not the PoolManager");
  });
});
