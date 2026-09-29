/**
 * @jest-environment node
 */
import ethereumPage from "./__fixtures__/opportunities-ethereum.json";
import polygonPage from "./__fixtures__/opportunities-polygon.json";
import { OpportunitiesPageSchema, type Opportunity } from "./fetch";
import { matchRewards, opportunityIdentifierOf, rewardsFromOpportunities } from "./match";

const WETH_TEL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const EUSD_EMXN = "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135";
const ETH_EUSD_TEL_ARCHIVED = "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0";

const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: "1",
  identifier: "0x10bc98e9459c8e746d08cdf09afe31a08830de0d",
  chainId: 137,
  type: "UNISWAP_V4_SUBSCRIPTION",
  status: "LIVE",
  apr: 10,
  dailyRewards: 100,
  tvl: 1_000,
  aprRecord: { breakdowns: [{ identifier: "0xc1", type: "CAMPAIGN", value: 10, distributionType: "DUTCH_AUCTION" }] },
  latestCampaignStart: 1_000_000,
  latestCampaignEnd: 2_000_000,
  ...overrides,
});

describe("opportunityIdentifierOf", () => {
  it("is the low 20 bytes of a 32-byte pool id, lowercased", () => {
    expect(opportunityIdentifierOf(WETH_TEL.toUpperCase().replace("0X", "0x"))).toBe("0x10bc98e9459c8e746d08cdf09afe31a08830de0d");
  });

  it("is null for an id that is not 32 bytes", () => {
    expect(opportunityIdentifierOf("0x10bc98e9459c8e746d08cdf09afe31a08830de0d")).toBeNull();
    expect(opportunityIdentifierOf("pool")).toBeNull();
  });
});

describe("rewardsFromOpportunities", () => {
  it("reports a single live opportunity with its campaign breakdown", () => {
    expect(rewardsFromOpportunities([opportunity()])).toEqual({
      status: "LIVE",
      apr: 10,
      aprBreakdown: [{ campaignId: "0xc1", apr: 10, distributionType: "DUTCH_AUCTION" }],
      dailyRewards: 100,
      subscribedTvlUSD: 1_000,
      campaignStart: 1_000_000,
      campaignEnd: 2_000_000,
    });
  });

  it("prefers live opportunities and sums their APR and daily rewards, keeping every campaign", () => {
    const rewards = rewardsFromOpportunities([
      opportunity({ status: "PAST", apr: 99, dailyRewards: 999, latestCampaignEnd: 900_000 }),
      opportunity(),
      opportunity({
        id: "2",
        apr: 5,
        dailyRewards: 50,
        tvl: 800,
        aprRecord: { breakdowns: [{ identifier: "0xc2", type: "CAMPAIGN", value: 5, distributionType: null }] },
        latestCampaignStart: 1_500_000,
        latestCampaignEnd: 3_000_000,
      }),
      opportunity({ status: "SOON", latestCampaignStart: 5_000_000 }),
    ]);

    expect(rewards).toEqual({
      status: "LIVE",
      apr: 15,
      aprBreakdown: [
        { campaignId: "0xc1", apr: 10, distributionType: "DUTCH_AUCTION" },
        { campaignId: "0xc2", apr: 5, distributionType: null },
      ],
      dailyRewards: 150,
      subscribedTvlUSD: 1_000,
      campaignStart: 1_000_000,
      campaignEnd: 3_000_000,
    });
  });

  it("keeps only campaign entries in the breakdown", () => {
    const rewards = rewardsFromOpportunities([
      opportunity({
        aprRecord: {
          breakdowns: [
            { identifier: "0xtoken", type: "TOKEN", value: 3 },
            { identifier: "0xc1", type: "CAMPAIGN", value: 10 },
          ],
        },
      }),
    ]);

    expect(rewards?.aprBreakdown).toEqual([{ campaignId: "0xc1", apr: 10, distributionType: null }]);
  });

  it("reports an unknown live rate as null rather than a partial sum", () => {
    expect(rewardsFromOpportunities([opportunity(), opportunity({ id: "2", apr: null })])).toMatchObject({ apr: null, dailyRewards: 200 });
  });

  it("reports the most recent PAST campaign with null rates when nothing is live", () => {
    const rewards = rewardsFromOpportunities([
      opportunity({ status: "PAST", apr: 0, dailyRewards: 0, tvl: 0, latestCampaignEnd: 1_500_000 }),
      opportunity({ id: "2", status: "PAST", apr: 40, dailyRewards: 10, tvl: 5, latestCampaignStart: 2_000_000, latestCampaignEnd: 2_500_000 }),
    ]);

    expect(rewards).toEqual({
      status: "PAST",
      apr: null,
      aprBreakdown: [],
      dailyRewards: null,
      subscribedTvlUSD: null,
      campaignStart: 2_000_000,
      campaignEnd: 2_500_000,
    });
  });

  it("reports an upcoming campaign ahead of a past one, with null rates", () => {
    const rewards = rewardsFromOpportunities([
      opportunity({ status: "PAST", latestCampaignEnd: 1_500_000 }),
      opportunity({ id: "2", status: "SOON", apr: 25, latestCampaignStart: 9_000_000, latestCampaignEnd: 9_500_000 }),
      opportunity({ id: "3", status: "SOON", latestCampaignStart: 8_000_000, latestCampaignEnd: 8_500_000 }),
    ]);

    expect(rewards).toEqual({
      status: "SOON",
      apr: null,
      aprBreakdown: [],
      dailyRewards: null,
      subscribedTvlUSD: null,
      campaignStart: 8_000_000,
      campaignEnd: 8_500_000,
    });
  });

  it("is null without a LIVE, SOON or PAST opportunity", () => {
    expect(rewardsFromOpportunities([])).toBeNull();
    expect(rewardsFromOpportunities([opportunity({ status: "NONE" }), opportunity({ status: "PAUSED" })])).toBeNull();
  });
});

describe("matchRewards", () => {
  it("matches the live Polygon opportunities to their pools by the low 20 bytes, whatever the case", () => {
    const entries = matchRewards("polygon", [WETH_TEL, EUSD_TEL, EUSD_EMXN], OpportunitiesPageSchema.parse(polygonPage));

    expect(entries.map(entry => [entry.id, entry.rewards.status])).toEqual([
      [WETH_TEL, "LIVE"],
      [EUSD_TEL, "LIVE"],
      [EUSD_EMXN, "LIVE"],
    ]);
    expect(entries[0].rewards).toMatchObject({ subscribedTvlUSD: 91_840.50118663275, campaignEnd: 1_790_899_200_000 });
  });

  it("matches the ended Ethereum opportunity as PAST and leaves the other pool out", () => {
    const entries = matchRewards("ethereum", [ETH_EUSD_TEL_ARCHIVED, EUSD_TEL], OpportunitiesPageSchema.parse(ethereumPage));

    expect(entries).toEqual([
      {
        id: ETH_EUSD_TEL_ARCHIVED,
        rewards: { status: "PAST", apr: null, aprBreakdown: [], dailyRewards: null, subscribedTvlUSD: null, campaignStart: null, campaignEnd: null },
      },
    ]);
  });

  it("gives no entry to a pool without an opportunity", () => {
    expect(matchRewards("base", [EUSD_TEL], [])).toEqual([]);
  });

  it("ignores opportunities from another chain or of another type", () => {
    const opportunities = [opportunity({ chainId: 8453 }), opportunity({ id: "2", type: "UNISWAP_V4" })];

    expect(matchRewards("polygon", [WETH_TEL], opportunities)).toEqual([]);
  });

  it("lists a pool id once, lowercased", () => {
    const entries = matchRewards("polygon", [WETH_TEL, WETH_TEL.toUpperCase().replace("0X", "0x")], [opportunity()]);

    expect(entries.map(entry => entry.id)).toEqual([WETH_TEL]);
  });
});
