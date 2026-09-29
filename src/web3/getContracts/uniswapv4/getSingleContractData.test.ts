import { uniswapGetSingleContractData } from "./getSingleContractData";
import { miningContract } from "@/helpers/normalizeMiningContracts";
import { GroupedPool } from "@/helpers/fetchGroupedSubgraph";
import { PoolMetrics } from "@/types/PoolMetrics";
import { PoolRewards } from "@/types/PoolRewards";

const contract = {
  name: "TEL/WETH",
  pool: "0xabc",
  protocol: "uniswap",
  blockchain: "polygon",
  active: true,
  deprecated: false,
  deprecatedStakingAddresses: [],
  assets: [],
  rewards: { rewardsInterval: null },
  links: { addLiquidity: "", poolAnalytics: null },
  illustration: "",
  subgraphId: "",
} as unknown as miningContract;

const now = 1_758_900_000;

beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(now * 1000));
afterEach(() => jest.restoreAllMocks());

const grouped = (overrides: Partial<GroupedPool>): GroupedPool => ({
  id: "0xabc",
  pool: { id: "0xabc", totalValueLockedUSD: "1000.5" },
  poolSnapshots: [],
  threeMonthLiquidityData: [],
  ...overrides,
});

const metrics: PoolMetrics = {
  tvlUSD: 2000,
  volume24h: 0,
  fees24h: 0,
  window: "trailing-24h",
  lastActivityAt: null,
  lastSwapAt: now - 3 * 86400,
  createdAt: now - 30 * 86400,
  rows24h: 0,
  computedAt: now,
};

describe("uniswapGetSingleContractData", () => {
  it("reads backend metrics when present, keeping a zero volume as zero", async () => {
    const data = await uniswapGetSingleContractData(contract, undefined, grouped({ metrics }));

    expect(data.totalLiquidity).toBe(2000);
    expect(data.dailyVolumeUSD).toBe(0);
    expect(data.fees24hr).toBe(0);
    expect(data.volume24hWindow).toBe("trailing-24h");
    expect(data.lastSwapAt).toBe(metrics.lastSwapAt);
    expect(data.createdAt).toBe(metrics.createdAt);
  });

  it("falls back to the trailing 24h sum without metrics", async () => {
    const poolSnapshots = [
      { periodStartUnix: now - 3600, volumeUSD: "10", feesUSD: "0.03" },
      { periodStartUnix: now - 86400, volumeUSD: "5", feesUSD: "0.015" },
      { periodStartUnix: now - 90000, volumeUSD: "100", feesUSD: "0.3" },
    ];

    const data = await uniswapGetSingleContractData(contract, undefined, grouped({ poolSnapshots }));

    expect(data.totalLiquidity).toBe(1000.5);
    expect(data.dailyVolumeUSD).toBe(15);
    expect(data.fees24hr).toBeCloseTo(0.045);
    expect(data.volume24hWindow).toBeUndefined();
  });

  it("yields zero, not a missing value, when the fallback rows sum to zero", async () => {
    const data = await uniswapGetSingleContractData(contract, undefined, grouped({}));

    expect(data.dailyVolumeUSD).toBe(0);
    expect(data.fees24hr).toBe(0);
  });

  it("leaves volume and fees unknown when a v2 payload has no metrics for the pool", async () => {
    const data = await uniswapGetSingleContractData(contract, undefined, grouped({ metrics: null }));

    expect(data.totalLiquidity).toBe(1000.5);
    expect(data.dailyVolumeUSD).toBeNull();
    expect(data.fees24hr).toBeNull();
  });

  it("yields null without subgraph data", async () => {
    const data = await uniswapGetSingleContractData(contract, undefined, undefined);

    expect(data.totalLiquidity).toBeNull();
    expect(data.dailyVolumeUSD).toBeNull();
    expect(data.fees24hr).toBeNull();
  });

  describe("Merkl rewards", () => {
    const rewards: PoolRewards = {
      status: "LIVE",
      apr: 66.9,
      aprBreakdown: [{ campaignId: "0xc1", apr: 66.9, distributionType: "DUTCH_AUCTION" }],
      dailyRewards: 168.4,
      subscribedTvlUSD: 91_840,
      campaignStart: 1_000,
      campaignEnd: 2_000,
      fetchedAt: 3_000,
    };

    it("carries the pool's rewards into the contract data", async () => {
      const data = await uniswapGetSingleContractData(contract, undefined, grouped({ metrics, rewards }));

      expect(data).toMatchObject({
        rewardsStatus: "LIVE",
        rewardsApr: 66.9,
        rewardsDailyRewards: 168.4,
        subscribedTvlUSD: 91_840,
        rewardsCampaignStart: 1_000,
        rewardsCampaignEnd: 2_000,
      });
    });

    it("keeps an ended campaign's status with its rates unknown", async () => {
      const ended: PoolRewards = { ...rewards, status: "PAST", apr: null, aprBreakdown: [], dailyRewards: null, subscribedTvlUSD: null };
      const data = await uniswapGetSingleContractData(contract, undefined, grouped({ rewards: ended }));

      expect(data).toMatchObject({ rewardsStatus: "PAST", rewardsApr: null, rewardsDailyRewards: null, subscribedTvlUSD: null });
    });

    it.each([
      ["no campaign matched", grouped({ rewards: null })],
      ["the payload has no rewards", grouped({})],
      ["there is no subgraph data", undefined],
    ])("leaves every rewards field null when %s", async (_case, pool) => {
      const data = await uniswapGetSingleContractData(contract, undefined, pool);

      expect(data).toMatchObject({
        rewardsStatus: null,
        rewardsApr: null,
        rewardsDailyRewards: null,
        subscribedTvlUSD: null,
        rewardsCampaignStart: null,
        rewardsCampaignEnd: null,
      });
    });
  });
});
