import { uniswapGetSingleContractData } from "./getSingleContractData";
import { miningContract } from "@/helpers/normalizeMiningContracts";
import { GroupedPool } from "@/helpers/fetchGroupedSubgraph";
import { PoolMetrics } from "@/types/PoolMetrics";

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

  it("yields null without subgraph data", async () => {
    const data = await uniswapGetSingleContractData(contract, undefined, undefined);

    expect(data.totalLiquidity).toBeNull();
    expect(data.dailyVolumeUSD).toBeNull();
    expect(data.fees24hr).toBeNull();
  });
});
