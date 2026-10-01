/**
 * @jest-environment node
 */
import { rpcPoolsFor } from "../registry";
import { campaignShareOfDay, campaignsOnDay, fetchPoolCampaigns } from "./campaigns";

const DAY = 86_400;
const D1 = Date.UTC(2026, 8, 25) / 1000;
const wethTel = rpcPoolsFor("polygon").find(pool => pool.id.startsWith("0xa22a3fb3"))!;

const opportunity = (id: string, identifier: string) => ({ id, identifier, chainId: 137, type: "UNISWAP_V4_SUBSCRIPTION", status: "LIVE" });
const merklCampaign = (overrides: Record<string, unknown> = {}) => ({
  campaignId: "0xDB432BF8",
  startTimestamp: D1,
  endTimestamp: String(D1 + 7 * DAY),
  amount: "499550000000000000000000",
  rewardToken: { address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731", decimals: 18, symbol: "TEL", price: 0.0021 },
  ...overrides,
});

function fakeFetch(pages: Record<string, unknown>) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    const key = Object.keys(pages).find(part => url.includes(part));
    return key ? new Response(JSON.stringify(pages[key]), { status: 200 }) : new Response("[]", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe("fetchPoolCampaigns", () => {
  it("reads the campaigns of each opportunity on our pools, in whole tokens", async () => {
    const identifier = `0x${wethTel.id.slice(-40)}`.toUpperCase().replace("0X", "0x");
    const { impl, urls } = fakeFetch({
      "/opportunities": [opportunity("135", identifier), opportunity("999", "0x0000000000000000000000000000000000000001")],
      "opportunityId=135": [merklCampaign(), merklCampaign({ campaignId: "0xempty", endTimestamp: D1 })],
    });

    expect(await fetchPoolCampaigns("polygon", [wethTel], impl)).toEqual([
      { id: "0xdb432bf8", poolId: wethTel.id, start: D1, end: D1 + 7 * DAY, amount: 499_550, token: "0x7e13b43065380acdec1c2d138c579cbbbafa0731", symbol: "TEL", priceUSD: 0.0021 },
    ]);
    expect(urls.some(url => url.includes("opportunityId=999"))).toBe(false);
  });

  it("fails rather than pass on a list that may be truncated or doesn't parse", async () => {
    const identifier = `0x${wethTel.id.slice(-40)}`;
    const full = fakeFetch({ "/opportunities": [opportunity("135", identifier)], "opportunityId=135": Array.from({ length: 100 }, () => merklCampaign()) });
    await expect(fetchPoolCampaigns("polygon", [wethTel], full.impl)).rejects.toThrow("truncated");
    const broken = fakeFetch({ "/opportunities": [opportunity("135", identifier)], "opportunityId=135": [{ campaignId: 1 }] });
    await expect(fetchPoolCampaigns("polygon", [wethTel], broken.impl)).rejects.toThrow("invalid response");
  });
});

describe("campaignShareOfDay", () => {
  const week = { start: D1 + 12 * 3600, end: D1 + 12 * 3600 + 7 * DAY };

  it("splits a campaign across the UTC days it covers", () => {
    const shares = Array.from({ length: 9 }, (_, i) => campaignShareOfDay(week, D1 - DAY + i * DAY));
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBeCloseTo(0.5 / 7);
    expect(shares[2]).toBeCloseTo(1 / 7);
    expect(shares[8]).toBeCloseTo(0.5 / 7);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });

  it("lists only the campaigns distributing that day", () => {
    const next = { start: week.end, end: week.end + DAY };
    expect(campaignsOnDay([week, next] as never, D1 + 7 * DAY)).toHaveLength(2);
    expect(campaignsOnDay([week, next] as never, D1 + 9 * DAY)).toHaveLength(0);
  });
});
