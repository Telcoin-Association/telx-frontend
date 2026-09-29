/**
 * @jest-environment node
 */
import fixtureJson from "../__fixtures__/rpc/polygon-2026-09-28.json";
import { rpcPoolsFor } from "../registry";
import { CHAINS, TEL } from "./chains";
import { fixtureBundleResults, fixtureRawLogs, type GoldenFixture } from "./fixture";
import { fetchPoolEvents } from "./logs";
import { buildPayload } from "./payload";
import { emptyLoaded, foldChunk } from "./runChain";
import { buildBundle } from "./snapshot";

/**
 * Replays the recorded Polygon logs (ModifyLiquidity since the pools' creation, Swaps for the 24 hours to
 * 2026-09-28 18:00 UTC, blocks 94,560,737 to 94,618,337) and the bundle at the last block, and checks the
 * figures measured independently for that window. The bundle's Chainlink ETH answer is $2,674.00, against the
 * $2,673.02 of the reference figures, which accounts for most of the WETH/TEL difference.
 */

const fixture = fixtureJson as unknown as GoldenFixture;
const config = CHAINS.polygon;
const pools = rpcPoolsFor("polygon");

const WETH_TEL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const EUSD_EMXN = "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135";

const EXPECTED = {
  [WETH_TEL]: { swaps: 1310, volume: 215_853, fees: 755.29, lpFees: 647.36, protocolFees: 107.93, tvl: 146_959 },
  [EUSD_TEL]: { swaps: 358, volume: 40_905, fees: 143.06, lpFees: 122.61, protocolFees: 20.44, tvl: 48_505 },
  // TVL at the Chainlink MXN/USD rate; the pool's own rate gives $45,741.
  [EUSD_EMXN]: { swaps: 227, volume: 981, fees: 0.61, lpFees: 0.49, protocolFees: 0.12, tvl: 45_457 },
};

const within = (actual: number, expected: number, tolerance: number) => Math.abs(actual / expected - 1) <= tolerance;

async function replay() {
  const raw = fixtureRawLogs(fixture, config.contracts.poolManager);
  const client = { request: async () => raw };
  const first = Math.min(...pools.map(pool => pool.createdBlock));
  const { events } = await fetchPoolEvents(client, config.contracts.poolManager, fixture.poolIds, {
    fromBlock: first,
    toBlock: fixture.toBlock,
    fromTime: 0,
    toTime: 0,
  });
  const snapshot = buildBundle(config, pools).decode(fixtureBundleResults(fixture));
  const loaded = emptyLoaded(pools);
  const { warnings } = foldChunk({ chain: "polygon", config, pools }, loaded, events, snapshot, "live", null);
  const payload = buildPayload({ pools, state: loaded.state, data: loaded.data, asOf: snapshot.timestamp, now: snapshot.timestamp, lagging: false });
  return { snapshot, loaded, payload, warnings };
}

describe("golden replay of Polygon, 24 hours to 2026-09-28 18:00 UTC", () => {
  it("prices from the bundle at the last block", async () => {
    const { loaded, snapshot, warnings } = await replay();
    const prices = loaded.state.prices!;

    expect(snapshot.block).toBe(fixture.toBlock);
    expect(prices.tokens["0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"]).toEqual({ usd: 2674.00199509, source: "feed" });
    expect(prices.tokens["0x68727e573d21a49c767c3c86a92d9f24bd933c99"]).toEqual({ usd: 0.0556951, source: "feed" });
    expect(prices.tokens["0x14913815bcfde78baead2111f463d038ac9c2949"]).toEqual({ usd: 1, source: "fixed" });
    // TEL is the mean of the two routes, both holding well over $5,000 on their other side.
    expect(prices.telRoutes.map(route => route.used)).toEqual([true, true]);
    expect(prices.tokens[TEL].usd).toBeCloseTo((prices.telRoutes[0].usd + prices.telRoutes[1].usd) / 2, 12);
    expect(within(prices.tokens[TEL].usd, 0.0024607, 0.01)).toBe(true);
    // eUSD/eMXN and MXN/USD imply eUSD at about $0.987, inside the 3% warning band.
    expect(prices.impliedEusd).toBeCloseTo(0.987, 3);
    expect(warnings).toEqual([]);
  });

  it.each(Object.entries(EXPECTED))("reproduces swaps, volume, fees and TVL for %s", async (id, expected) => {
    const { loaded, payload } = await replay();
    const pool = payload.find(entry => entry.id === id)!;
    const buckets = [...loaded.data[id].buckets.values()];
    const lpFees = buckets.reduce((sum, bucket) => sum + bucket.lpFeesUSD, 0);
    const protocolFees = buckets.reduce((sum, bucket) => sum + bucket.protocolFeesUSD, 0);

    expect(pool.metrics.rows24h).toBe(expected.swaps);
    expect(within(pool.metrics.volume24h!, expected.volume, 0.001)).toBe(true);
    expect(within(pool.metrics.fees24h!, expected.fees, id === EUSD_EMXN ? 0.01 : 0.001)).toBe(true);
    expect(within(lpFees, expected.lpFees, id === EUSD_EMXN ? 0.01 : 0.001)).toBe(true);
    expect(within(protocolFees, expected.protocolFees, id === EUSD_EMXN ? 0.03 : 0.001)).toBe(true);
    expect(within(pool.metrics.tvlUSD!, expected.tvl, 0.005)).toBe(true);
  });

  it("gets the same TVL from ReservesLens and from the position sum", async () => {
    const { loaded } = await replay();
    for (const pool of pools) {
      const state = loaded.state.pools[pool.id];
      expect(state.reserves?.source).toBe("lens");
      expect(within(state.tvlPositionsUSD!, state.tvlLensUSD!, 0.005)).toBe(true);
    }
  });
});
