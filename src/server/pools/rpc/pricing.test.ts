/**
 * @jest-environment node
 */
import { rpcPoolsFor } from "../registry";
import { CHAINS, TEL } from "./chains";
import { MAX_MOVE, MIN_ROUTE_USD, priceChain, type PricingInput } from "./pricing";
import type { ChainSnapshot } from "./snapshot";

const WETH = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
const EUSD = "0x14913815bcfde78baead2111f463d038ac9c2949";
const EMXN = "0x68727e573d21a49c767c3c86a92d9f24bd933c99";
const WETH_TEL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const EUSD_EMXN = "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135";
const NOW = 1_800_000_000;

const sqrtPrice = (oneInZero: number, decimals0: number, decimals1: number) =>
  (BigInt(Math.round(Math.sqrt(oneInZero * 10 ** (decimals1 - decimals0)) * 1e9)) * 2n ** 96n) / 10n ** 9n;
const slot0 = (sqrtPriceX96: bigint) => ({ sqrtPriceX96, tick: 0, protocolFee: 0, lpFee: 3000 });

/** Polygon at ETH $2,000 and MXN $0.05, with TEL at $0.002 through WETH and $0.0021 through eUSD. */
function input(overrides: Partial<PricingInput> = {}, snapshotOverrides: Partial<ChainSnapshot> = {}): PricingInput {
  const snapshot: ChainSnapshot = {
    block: 1,
    timestamp: NOW,
    feeds: {
      "ETH/USD": { answer: 2000n * 10n ** 8n, updatedAt: NOW - 10 },
      "MXN/USD": { answer: 5n * 10n ** 6n, updatedAt: NOW - 3600 },
    },
    pools: {
      [WETH_TEL]: { reserves: null, liquidity: null, slot0: slot0(sqrtPrice(1_000_000, 18, 18)) },
      [EUSD_TEL]: { reserves: null, liquidity: null, slot0: slot0(sqrtPrice(1 / 0.0021, 6, 18)) },
      [EUSD_EMXN]: { reserves: null, liquidity: null, slot0: slot0(sqrtPrice(20, 6, 6)) },
    },
    ...snapshotOverrides,
  };
  return {
    config: CHAINS.polygon,
    pools: rpcPoolsFor("polygon"),
    snapshot,
    reserves: {
      [WETH_TEL]: { amount0: 10n * 10n ** 18n, amount1: 0n }, // $20,000 of WETH
      [EUSD_TEL]: { amount0: 10_000n * 10n ** 6n, amount1: 0n }, // $10,000 of eUSD
      [EUSD_EMXN]: null,
    },
    last: {},
    polygonTel: null,
    ...overrides,
  };
}

describe("priceChain", () => {
  it("prices feed tokens from Chainlink, eUSD at $1 and TEL as the mean of two routes", () => {
    const prices = priceChain(input());

    expect(prices.tokens[WETH]).toEqual({ usd: 2000, source: "feed" });
    expect(prices.tokens[EMXN]).toEqual({ usd: 0.05, source: "feed" });
    expect(prices.tokens[EUSD]).toEqual({ usd: 1, source: "fixed" });
    expect(prices.telRoutes.map(route => [route.poolId, route.used])).toEqual([
      [WETH_TEL, true],
      [EUSD_TEL, true],
    ]);
    expect(prices.tokens[TEL].source).toBe("pools");
    expect(prices.tokens[TEL].usd).toBeCloseTo(0.00205, 9);
    expect(prices.warnings).toEqual([]);
  });

  it("takes the median of three routes", () => {
    const pools = rpcPoolsFor("polygon");
    const extra = { ...pools[0], id: "0x01" };
    const prices = priceChain(
      input(
        { pools: [...pools, extra], reserves: { ...input().reserves, "0x01": { amount0: 10n * 10n ** 18n, amount1: 0n } } },
        { pools: { ...input().snapshot.pools, "0x01": { reserves: null, liquidity: null, slot0: slot0(sqrtPrice(500_000, 18, 18)) } } },
      ),
    );
    expect(prices.tokens[TEL].usd).toBeCloseTo(0.0021, 9);
  });

  it("drops a route whose other side holds under $5,000", () => {
    const prices = priceChain(
      input({ reserves: { ...input().reserves, [EUSD_TEL]: { amount0: BigInt(MIN_ROUTE_USD - 1) * 10n ** 6n, amount1: 0n } } }),
    );
    expect(prices.telRoutes.find(route => route.poolId === EUSD_TEL)?.used).toBe(false);
    expect(prices.tokens[TEL].usd).toBeCloseTo(0.002, 9);
  });

  it("clamps a move of more than 20% from the last TEL price, and flags it", () => {
    const prices = priceChain(input({ last: { [TEL]: 0.0015 } }));
    expect(prices.tokens[TEL]).toEqual({ usd: 0.0015 * (1 + MAX_MOVE), source: "pools", clamped: true });
    expect(prices.warnings).toEqual([expect.stringContaining("clamped")]);
  });

  it.each([
    ["stale", { answer: 2000n * 10n ** 8n, updatedAt: NOW - 60 - 601 }, "old"],
    ["non-positive", { answer: 0n, updatedAt: NOW }, "answered 0"],
    ["missing", null, "did not answer"],
  ])("falls back to the last stored price on a %s feed, flagged", (_name, round, message) => {
    const prices = priceChain(input({ last: { [WETH]: 1900 } }, { feeds: { ...input().snapshot.feeds, "ETH/USD": round } }));
    expect(prices.tokens[WETH]).toEqual({ usd: 1900, source: "last", stale: true });
    expect(prices.warnings[0]).toContain(message);
  });

  it("leaves a feed token without a price when there is no stored one", () => {
    const prices = priceChain(input({}, { feeds: { ...input().snapshot.feeds, "ETH/USD": null } }));
    expect(prices.tokens[WETH]).toBeUndefined();
  });

  it("without a usable TEL route takes Polygon's price on another chain, then Merkl's, then the last one, then the thin routes", () => {
    const thin = { [WETH_TEL]: { amount0: 1n, amount1: 0n }, [EUSD_TEL]: { amount0: 1n, amount1: 0n }, [EUSD_EMXN]: null };
    const base = CHAINS.base;
    const polygonFallback = priceChain(input({ config: base, pools: [], reserves: {}, polygonTel: 0.0022, merklTel: 0.0023 }));
    expect(polygonFallback.tokens[TEL]).toEqual({ usd: 0.0022, source: "polygon", stale: true });

    expect(priceChain(input({ reserves: thin, merklTel: 0.0023, last: { [TEL]: 0.0019 } })).tokens[TEL]).toEqual({
      usd: 0.0023,
      source: "merkl",
      stale: true,
    });
    expect(priceChain(input({ reserves: thin, last: { [TEL]: 0.0019 } })).tokens[TEL]).toEqual({ usd: 0.0019, source: "last", stale: true });
    const thinOnly = priceChain(input({ reserves: thin }));
    expect(thinOnly.tokens[TEL]).toMatchObject({ source: "pools", stale: true });
    expect(thinOnly.warnings).toEqual([expect.stringContaining("under $5000")]);
  });

  it("warns when the route price is more than 10% from Merkl's, and keeps the route price", () => {
    expect(priceChain(input({ merklTel: 0.00204 })).warnings).toEqual([]);
    const far = priceChain(input({ merklTel: 0.0017 }));
    expect(far.tokens[TEL].source).toBe("pools");
    expect(far.warnings).toEqual([expect.stringContaining("from Merkl's")]);
  });

  it("records the eUSD price implied by eUSD/eMXN and warns past 3%", () => {
    expect(priceChain(input()).impliedEusd).toBeCloseTo(1, 6);
    const off = priceChain(
      input({}, { pools: { ...input().snapshot.pools, [EUSD_EMXN]: { reserves: null, liquidity: null, slot0: slot0(sqrtPrice(19, 6, 6)) } } }),
    );
    expect(off.impliedEusd).toBeCloseTo(0.95, 6);
    expect(off.warnings).toEqual([expect.stringContaining("implies eUSD")]);
  });
});
