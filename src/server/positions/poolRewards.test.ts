/**
 * @jest-environment node
 */
import {
  buildPoolRewardsIndex,
  campaignIsFinal,
  classifyReason,
  clearPoolRewardsCache,
  fetchCampaignRows,
  fetchPoolTelCampaigns,
  poolRewardsIndex,
  POOL_REWARDS_TTL_MS,
  sumCampaignRows,
  TEL_V3,
  type PoolCampaign,
  type RewardRow,
} from "./poolRewards";

const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const OTHER_POOL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const NOT_TEL = "0x0000000000000000000000000000000000000bbb";
const WEI = 10n ** 18n;
const NOW = 1_791_000_000;
const SETTLED = { endOfDisputePeriod: NOW - 60, disputer: "0x0000000000000000000000000000000000000000" };

const reason = (tokenId: string) => `MultiLogPerAdditionalParam_tokenId_${tokenId}_7140342370385179795`;
const row = (r: string, amount: bigint, pending = 0n): RewardRow => ({ reason: r, amount: amount.toString(), pending: pending.toString() });

const campaign = (id: string, fields: Partial<Record<string, unknown>> = {}) => ({
  campaignId: id,
  distributionChainId: 137,
  startTimestamp: NOW - 10 * 86_400,
  endTimestamp: NOW - 3 * 86_400,
  amount: (1000n * WEI).toString(),
  params: { poolId: POOL },
  rewardToken: { address: TEL },
  campaignStatus: { computedUntil: NOW - 3 * 86_400 },
  ...fields,
});

/** A fake Merkl API: campaign pages for the chain listing, and reward rows per campaign, paged as Merkl does. */
function fakeMerkl(campaignPages: unknown[][], rowsByCampaign: Record<string, RewardRow[]>, rowPage = 1000) {
  const calls: string[] = [];
  const fetchImpl = jest.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams}`);
    const page = Number(url.searchParams.get("page"));
    if (url.pathname.endsWith("/campaigns")) return { ok: true, json: async () => campaignPages[page] ?? [] };
    const rows = rowsByCampaign[url.searchParams.get("campaignId")!] ?? [];
    return { ok: true, json: async () => rows.slice(page * rowPage, (page + 1) * rowPage) };
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("classifyReason", () => {
  it("reads the position from a subscription reason, and sets apart rows for no position", () => {
    expect(classifyReason(reason("144097"))).toEqual({ kind: "position", tokenId: "144097" });
    expect(classifyReason("roundingError")).toEqual({ kind: "none" });
    expect(classifyReason("no_recipient")).toEqual({ kind: "none" });
    expect(classifyReason("UniswapV4_0xabc")).toEqual({ kind: "unresolved" });
    expect(classifyReason("MultiLogPerAdditionalParam_tokenId_x_1")).toEqual({ kind: "unresolved" });
  });
});

describe("fetchPoolTelCampaigns", () => {
  it("keeps the pool's TEL campaigns, matching the token by address, and pages the listing", async () => {
    const full = Array.from({ length: 100 }, (_, i) => campaign(`0xfill${i}`, { params: { poolId: OTHER_POOL } }));
    const { fetchImpl, calls } = fakeMerkl(
      [
        [...full.slice(0, 98), campaign("0xA1"), campaign("0xa2", { rewardToken: { address: NOT_TEL } })],
        [campaign("0xa3", { params: { poolId: POOL.toUpperCase().replace("0X", "0x") } })],
      ],
      {}
    );
    const campaigns = await fetchPoolTelCampaigns(137, POOL, fetchImpl);
    expect(campaigns.map(c => c.id)).toEqual(["0xa1", "0xa3"]);
    expect(campaigns[0]).toMatchObject({ distributionChainId: 137, amount: 1000n * WEI, computedUntil: NOW - 3 * 86_400 });
    expect(calls).toEqual([
      "/v4/campaigns?chainId=137&type=UNISWAP_V4_SUBSCRIPTION&status=LIVE%2CSOON%2CPAST&items=100&page=0",
      "/v4/campaigns?chainId=137&type=UNISWAP_V4_SUBSCRIPTION&status=LIVE%2CSOON%2CPAST&items=100&page=1",
    ]);
  });
});

describe("fetchCampaignRows", () => {
  it("pages from 0 until a page comes back short", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row(reason(String(i)), 1n));
    const { fetchImpl, calls } = fakeMerkl([], { "0xc1": rows });
    await expect(fetchCampaignRows(137, "0xc1", fetchImpl)).resolves.toHaveLength(2500);
    expect(calls).toEqual([0, 1, 2].map(page => `/v4/rewards?chainId=137&campaignId=0xc1&items=1000&page=${page}`));
  });

  it("reads one more page when the last full page ends exactly on the page size", async () => {
    const { fetchImpl, calls } = fakeMerkl([], { "0xc1": Array.from({ length: 1000 }, () => row(reason("1"), 1n)) });
    await fetchCampaignRows(137, "0xc1", fetchImpl);
    expect(calls).toHaveLength(2);
  });
});

describe("sumCampaignRows", () => {
  it("sums each position's credited and pending wei, counts unresolved rows, and totals every row", () => {
    const sums = sumCampaignRows([
      row(reason("1"), 10n * WEI, 2n * WEI),
      row(reason("1"), 5n * WEI),
      row(reason("2"), 7n * WEI, 1n * WEI),
      row("roundingError", 3n),
      row("no_recipient", 4n * WEI),
      row("SomethingNew_0x1", 6n * WEI),
    ]);
    expect(sums.perToken.get("1")).toEqual({ amount: 15n * WEI, pending: 2n * WEI });
    expect(sums.perToken.get("2")).toEqual({ amount: 7n * WEI, pending: 1n * WEI });
    expect(sums.unresolved).toBe(1);
    expect(sums.pendingTotal).toBe(3n * WEI);
    expect(sums.allRows).toBe(35n * WEI + 3n);
  });

  it("conserves the campaign's net amount: every row, rounding and unassigned included, adds up to it", () => {
    // A settled campaign of 499,550 TEL: 105 positions and one rounding row.
    const net = 499_550n * WEI;
    const rows = [...Array.from({ length: 105 }, (_, i) => row(reason(String(i)), net / 105n)), row("roundingError", net - (net / 105n) * 105n)];
    const sums = sumCampaignRows(rows);
    // Merkl's engine can leave each row short by up to a wei per run; here there is none.
    expect(sums.allRows - net).toBe(0n);
  });
});

describe("campaignIsFinal", () => {
  const settled: PoolCampaign = { id: "0xc1", distributionChainId: 137, start: NOW - 864_000, end: NOW - 86_400, amount: 1n, computedUntil: NOW - 86_400 };

  it("is final once ended, computed to its end, with nothing pending, past the dispute window and with no disputer", () => {
    expect(campaignIsFinal(settled, 0n, SETTLED, NOW)).toBe(true);
  });

  it.each([
    ["still running", { ...settled, end: NOW + 60 }, 0n, SETTLED],
    ["not computed to its end", { ...settled, computedUntil: settled.end - 1 }, 0n, SETTLED],
    ["with no computation status", { ...settled, computedUntil: null }, 0n, SETTLED],
    ["with rewards still pending", settled, 1n, SETTLED],
    ["inside the dispute window", settled, 0n, { ...SETTLED, endOfDisputePeriod: NOW + 60 }],
    ["under dispute", settled, 0n, { ...SETTLED, disputer: "0x00000000000000000000000000000000000000d1" }],
  ])("is provisional %s", (_, c, pending, dispute) => {
    expect(campaignIsFinal(c as PoolCampaign, pending as bigint, dispute as typeof SETTLED, NOW)).toBe(false);
  });
});

describe("buildPoolRewardsIndex", () => {
  it("sums each position over the pool's campaigns, and is final only where every campaign it is in is final", async () => {
    const { fetchImpl } = fakeMerkl([[campaign("0xold"), campaign("0xlive", { startTimestamp: NOW - 86_400, endTimestamp: NOW + 86_400, campaignStatus: { computedUntil: NOW - 600 } })]], {
      "0xold": [row(reason("1"), 100n * WEI), row(reason("2"), 50n * WEI), row("roundingError", 1n)],
      "0xlive": [row(reason("1"), 10n * WEI, 4n * WEI)],
    });
    const readDispute = jest.fn(async () => SETTLED);

    const index = await buildPoolRewardsIndex("polygon", POOL, { fetchImpl, readDispute, now: () => NOW * 1000 });

    expect(index.positions["1"]).toEqual({ reward: 114, claimable: 110, pending: 4, final: false });
    expect(index.positions["2"]).toEqual({ reward: 50, claimable: 50, pending: 0, final: true });
    expect(index.campaigns.map(c => [c.id, c.final])).toEqual([
      ["0xold", true],
      ["0xlive", false],
    ]);
    expect(index.unresolved).toBe(0);
    // One dispute read per distribution chain, shared by its campaigns.
    expect(readDispute).toHaveBeenCalledTimes(1);
  });

  it("reports rows it couldn't attribute instead of dropping them silently", async () => {
    const { fetchImpl } = fakeMerkl([[campaign("0xc1")]], { "0xc1": [row(reason("1"), WEI), row("Unknown_reason", WEI)] });
    const index = await buildPoolRewardsIndex("polygon", POOL, { fetchImpl, readDispute: async () => SETTLED, now: () => NOW * 1000 });
    expect(index.unresolved).toBe(1);
    expect(index.positions).toEqual({ "1": { reward: 1, claimable: 1, pending: 0, final: true } });
  });

  it("keeps exact sums past float precision, adding in wei before converting", async () => {
    const odd = 123_456_789_012_345_678_901n;
    const { fetchImpl } = fakeMerkl([[campaign("0xc1")]], { "0xc1": [row(reason("1"), odd), row(reason("1"), odd)] });
    const index = await buildPoolRewardsIndex("polygon", POOL, { fetchImpl, readDispute: async () => SETTLED, now: () => NOW * 1000 });
    expect(index.positions["1"].reward).toBeCloseTo(246.913578024691, 9);
  });
});

describe("poolRewardsIndex cache", () => {
  beforeEach(() => clearPoolRewardsCache());

  it("serves one build per pool until it expires, and rebuilds after a failure", async () => {
    let now = NOW * 1000;
    const { fetchImpl } = fakeMerkl([[campaign("0xc1")]], { "0xc1": [row(reason("1"), WEI)] });
    const deps = { fetchImpl, readDispute: jest.fn(async () => SETTLED), now: () => now };

    await Promise.all([poolRewardsIndex("polygon", POOL, deps), poolRewardsIndex("polygon", POOL.toUpperCase().replace("0X", "0x"), deps)]);
    expect(deps.readDispute).toHaveBeenCalledTimes(1);
    now += POOL_REWARDS_TTL_MS + 1;
    await poolRewardsIndex("polygon", POOL, deps);
    expect(deps.readDispute).toHaveBeenCalledTimes(2);

    const failing = { ...deps, readDispute: jest.fn(async () => Promise.reject(new Error("rpc down"))) };
    now += POOL_REWARDS_TTL_MS + 1;
    await expect(poolRewardsIndex("polygon", POOL, failing)).rejects.toThrow("rpc down");
    await expect(poolRewardsIndex("polygon", POOL, deps)).resolves.toMatchObject({ positions: { "1": { reward: 1 } } });
  });
});

it("TEL v3 is matched by its lowercase address", () => {
  expect(TEL_V3).toBe(TEL.toLowerCase());
});
