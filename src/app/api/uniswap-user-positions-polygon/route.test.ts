/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

const readContract = jest.fn();
jest.mock("../backendHelpers/alchemy", () => {
  const client = { readContract: (...args: unknown[]) => readContract(...args) };
  return { publicClientPolygon: client, publicClientBase: client, publicClientEthereum: client };
});

const listOwnedTokenIds = jest.fn();
jest.mock("../backendHelpers/positionTokens", () => ({
  ...jest.requireActual("../backendHelpers/positionTokens"),
  listOwnedTokenIds: (...args: unknown[]) => listOwnedTokenIds(...args),
}));

import { NextRequest } from "next/server";
import { HttpRequestError } from "viem";
import { GET as getPolygon } from "./route";
import { GET as getBase } from "../uniswap-user-positions-base/route";
import { GET as getEthereum } from "../uniswap-user-positions-ethereum/route";
import { findUniswapV4Pool } from "../backendHelpers/uniswapPools";

const USER = "0x00000000000000000000000000000000000000aa";
// eUSD/TEL on Polygon: token0 has 6 decimals and token1 has 18 in pool.json.
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
// ETH/TEL on Ethereum only, not registered on Polygon.
const ETHEREUM_ONLY = "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6";

const request = (query: Record<string, string>, chain = "polygon") =>
  new NextRequest(`https://telx.network/api/uniswap-user-positions-${chain}?${new URLSearchParams(query)}`);

// A positionInfo word whose top 25 bytes are the pool id prefix, with zero ticks.
const positionInfoFor = (poolId: string) => BigInt(poolId.slice(0, 52) + "00".repeat(7));

beforeEach(() => {
  readContract.mockReset();
  listOwnedTokenIds.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("findUniswapV4Pool", () => {
  it("returns the registry decimals for a known pool id on its chain, in any case", () => {
    expect(findUniswapV4Pool("polygon", EUSD_TEL.toUpperCase().replace("0X", "0x"))).toEqual({
      poolId: EUSD_TEL,
      amount0Decimals: 6,
      amount1Decimals: 18,
    });
  });

  it("returns null for a pool registered only on another chain, and for junk", () => {
    expect(findUniswapV4Pool("polygon", ETHEREUM_ONLY)).toBeNull();
    expect(findUniswapV4Pool("ethereum", ETHEREUM_ONLY)).not.toBeNull();
    expect(findUniswapV4Pool("polygon", "0x1234")).toBeNull();
    expect(findUniswapV4Pool("polygon", null)).toBeNull();
  });
});

describe.each([
  ["polygon", getPolygon],
  ["base", getBase],
  ["ethereum", getEthereum],
])("GET /api/uniswap-user-positions-%s input validation", (chain, GET) => {
  it("returns 400 for a malformed userAddress", async () => {
    const res = await GET(request({ userAddress: "0x123", poolAddress: EUSD_TEL }, chain));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a pool id that pool.json does not list, before any upstream call", async () => {
    const res = await GET(request({ userAddress: USER, poolAddress: "0x" + "ab".repeat(32) }, chain));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown poolAddress" });
    expect(listOwnedTokenIds).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("GET /api/uniswap-user-positions-polygon", () => {
  it("rejects a pool that is registered on another chain only", async () => {
    const res = await getPolygon(request({ userAddress: USER, poolAddress: ETHEREUM_ONLY }));
    expect(res.status).toBe(400);
  });

  it("answers an unexpected failure with a fixed 500 body and logs it without the Alchemy key", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    listOwnedTokenIds.mockRejectedValue(
      new HttpRequestError({ url: "https://polygon-mainnet.g.alchemy.com/v2/SECRETKEY", status: 500, body: {}, details: "boom" }),
    );

    const res = await getPolygon(request({ userAddress: USER, poolAddress: EUSD_TEL }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("HttpRequestError");
    expect(logged).not.toContain("SECRETKEY");
  });

  it("formats amounts with the registry decimals and ignores decimals sent by the client", async () => {
    listOwnedTokenIds.mockResolvedValue({ ids: ["7"], truncated: false });
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "unclaimedRewards":
          return 0n;
        case "positionInfo":
          return positionInfoFor(EUSD_TEL);
        case "getPositionLiquidity":
          return 1n;
        case "isTokenSubscribed":
          return true;
        case "getAmountsForLiquidity":
          return [1_500_000n, 2n * 10n ** 18n, 2n ** 96n];
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    });

    const res = await getPolygon(request({ userAddress: USER, poolAddress: EUSD_TEL, amount0Decimals: "0", amount1Decimals: "junk" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0].amounts).toMatchObject({ amount0: "1.5", amount1: "2" });
    expect(body.positions[0].price.price1Per0).toBeCloseTo(1e-12);
  });
});
