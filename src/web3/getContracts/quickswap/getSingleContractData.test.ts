import { quickswapGetSingleContractData } from "./getSingleContractData";
import type { miningContract } from "../../../helpers/normalizeMiningContracts";

const mockStakeInfo = jest.fn();
jest.mock("./getStakeInfo", () => ({ quickswapGetStakeInfo: (...args: unknown[]) => mockStakeInfo(...args) }));

const value = {
  name: "TEL 50 USDC 50",
  pool: "0xpool",
  active: false,
  deprecated: true,
  rewards: { type: "single", rewardsInterval: "week" },
  activeStakingAddress: { address: "0xstake" },
  deprecatedStakingAddresses: [],
  assets: [],
  links: { addLiquidity: "", poolAnalytics: "" },
} as unknown as miningContract;

const stakeInfo = (fields: Record<string, unknown>) => ({ rewards: [], balanceLPT: 0, stakedLPT: 0, stakedUSD: 0, ...fields });

describe("quickswapGetSingleContractData staked liquidity", () => {
  it("reads an unknown staked liquidity as null, not 0", async () => {
    mockStakeInfo.mockResolvedValue(stakeInfo({ stakedLiquidity: undefined }));
    await expect(quickswapGetSingleContractData(value, undefined)).resolves.toMatchObject({ stakedLiquidity: null });
  });

  it("keeps a known staked liquidity, including 0", async () => {
    mockStakeInfo.mockResolvedValue(stakeInfo({ stakedLiquidity: 0 }));
    await expect(quickswapGetSingleContractData(value, undefined)).resolves.toMatchObject({ stakedLiquidity: 0 });
    mockStakeInfo.mockResolvedValue(stakeInfo({ stakedLiquidity: 1234.5 }));
    await expect(quickswapGetSingleContractData(value, undefined)).resolves.toMatchObject({ stakedLiquidity: 1234.5 });
  });
});
