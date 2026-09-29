/**
 * @jest-environment node
 */
import { MERKL_POSITION_REGISTRY, POLYGON_POSITION_MANAGER, POLYGON_POSITION_REGISTRY } from "@/lib/contracts";
import { MULTICALL_BATCH_BYTES, readPositions } from "./read";
import { fakeMulticall, positionInfoFor, type FakeChainState } from "./testing";

const OWNER = "0x00000000000000000000000000000000000000Aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
// Polygon registry pools: eUSD/TEL uses the Merkl registry, TEL/WETH (inactive) the Polygon one.
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const TEL_WETH = "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7";
const UNLISTED_POOL = "0x" + "ab".repeat(32);

function setup(state: FakeChainState) {
  const fake = fakeMulticall(state);
  const multicall = jest.fn(fake.multicall);
  const client = { multicall } as unknown as Parameters<typeof readPositions>[0]["client"];
  const read = (tokenIds: string[]) => readPositions({ client, chain: "polygon", positionManager: POLYGON_POSITION_MANAGER, owner: OWNER, tokenIds });
  return { read, multicall, batches: fake.batches };
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("readPositions", () => {
  it("reads any number of tokens in two multicall rounds with allowFailure and a large batch size", async () => {
    const ids = Array.from({ length: 85 }, (_, i) => String(i + 1));
    const state: FakeChainState = {
      owners: Object.fromEntries(ids.map(id => [id, OWNER])),
      info: Object.fromEntries(ids.map(id => [id, positionInfoFor(EUSD_TEL)])),
      liquidity: Object.fromEntries(ids.map(id => [id, 1n])),
    };
    const { read, multicall, batches } = setup(state);

    const pools = await read(ids);
    expect(multicall).toHaveBeenCalledTimes(2);
    expect(multicall.mock.calls[0][0]).toMatchObject({ allowFailure: true, batchSize: MULTICALL_BATCH_BYTES });
    expect(batches[0].map(call => call.functionName).slice(0, 3)).toEqual(["ownerOf", "positionInfo", "getPositionLiquidity"]);
    expect(batches[0]).toHaveLength(85 * 3);
    // Two registry reads per held token, plus unclaimedRewards once per distinct registry on the chain.
    expect(batches[1]).toHaveLength(85 * 2 + 2);
    expect(pools[EUSD_TEL].positions).toHaveLength(85);
  });

  it("drops tokens the owner does not hold and tokens whose ownerOf reverts", async () => {
    const { read } = setup({
      owners: { "1": OWNER.toLowerCase(), "2": OTHER },
      info: { "1": positionInfoFor(EUSD_TEL), "2": positionInfoFor(EUSD_TEL), "3": positionInfoFor(EUSD_TEL) },
      liquidity: { "1": 5n, "2": 5n, "3": 5n },
    });
    const pools = await read(["1", "2", "3"]);
    expect(pools[EUSD_TEL].positions.map(p => p.tokenId)).toEqual(["1"]);
  });

  it("groups positions by registry pool, drops unlisted pools, and gives every registry pool an entry", async () => {
    const { read, batches } = setup({
      owners: { "1": OWNER, "2": OWNER, "3": OWNER },
      info: { "1": positionInfoFor(EUSD_TEL), "2": positionInfoFor(TEL_WETH), "3": positionInfoFor(UNLISTED_POOL) },
      liquidity: { "1": 1n, "2": 0n, "3": 1n },
      subscribed: { "1": true },
      unclaimed: { [MERKL_POSITION_REGISTRY.toLowerCase()]: 7n },
    });
    const pools = await read(["1", "2", "3"]);

    expect(pools[EUSD_TEL]).toEqual({
      claimableAmount: "7",
      positions: [
        {
          tokenId: "1",
          isSubscribed: true,
          tickLower: 0,
          tickUpper: 0,
          liquidity: "1",
          amounts: { amount0: "1.5", amount1: "2", sqrtPriceX96: (2n ** 96n).toString() },
          price: { price1Per0: expect.closeTo(1e-12), price0Per1: expect.closeTo(1e12) },
        },
      ],
    });
    expect(pools[TEL_WETH].positions.map(p => p.tokenId)).toEqual(["2"]);
    expect(pools[TEL_WETH].claimableAmount).toBe("0");
    expect(Object.keys(pools)).toContain("0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d");
    expect(Object.keys(pools).every(id => id === id.toLowerCase())).toBe(true);

    // Registry reads go to each pool's own registry, and the unlisted pool's token gets none.
    const subscribedReads = batches[1].filter(call => call.functionName === "isTokenSubscribed");
    expect(subscribedReads.map(call => [String(call.args[0]), call.address])).toEqual([
      ["1", MERKL_POSITION_REGISTRY],
      ["2", POLYGON_POSITION_REGISTRY],
    ]);
  });

  it("drops a token whose registry reads fail and keeps the others, with a warning", async () => {
    const { read } = setup({
      owners: { "1": OWNER, "2": OWNER },
      info: { "1": positionInfoFor(EUSD_TEL), "2": positionInfoFor(EUSD_TEL) },
      liquidity: { "1": 1n, "2": 1n },
      failing: ["1"],
    });
    const pools = await read(["1", "2"]);
    expect(pools[EUSD_TEL].positions.map(p => p.tokenId)).toEqual(["2"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("position 1 on polygon"), expect.any(String));
  });

  it("sends no per-token reads for an empty wallet but still reads unclaimed rewards", async () => {
    const { read, batches } = setup({ owners: {}, info: {}, liquidity: {} });
    const pools = await read([]);
    expect(batches).toHaveLength(1);
    expect(batches[0].every(call => call.functionName === "unclaimedRewards")).toBe(true);
    expect(pools[EUSD_TEL]).toEqual({ positions: [], claimableAmount: "0" });
  });

  it("rejects when a multicall itself fails", async () => {
    const client = { multicall: jest.fn().mockRejectedValue(new Error("rpc down")) } as unknown as Parameters<typeof readPositions>[0]["client"];
    await expect(
      readPositions({ client, chain: "polygon", positionManager: POLYGON_POSITION_MANAGER, owner: OWNER, tokenIds: ["1"] }),
    ).rejects.toThrow("rpc down");
  });
});
