/**
 * @jest-environment node
 */
import { balancerGetSingleContractData } from "./getSingleContractData";
import { getPoolLiquidityValue } from "./vault";
import { getPoolContractValues } from "../all/getPoolContractValues";
import { hasUserStake } from "../../../redux/slices/contractsSlice";

const mockPoolBalanceOf = jest.fn();
const mockStakeBalanceOf = jest.fn();
const mockEarned = jest.fn();

jest.mock("ethers", () => {
  const actual = jest.requireActual("ethers");
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: jest.fn(() => ({ balanceOf: mockPoolBalanceOf })) },
  };
});
jest.mock("../../../lib/ethersProvider", () => ({ provider: {} }));
jest.mock("../all/createStakingContract", () => ({
  createStakingContract: jest.fn(async () => ({ balanceOf: mockStakeBalanceOf, earned: mockEarned })),
}));
jest.mock("../all/getPoolContractValues", () => ({ getPoolContractValues: jest.fn() }));
jest.mock("./vault", () => ({ getPoolLiquidityValue: jest.fn() }));

const WALLET = "0x00000000000000000000000000000000000000aa";
const ONE = 10n ** 18n;

// The deprecated TEL 80 USDC 20 pool: inactive, with its rewards in a retired staking contract.
const telUsdc = {
  name: "TEL 80 USDC 20",
  pool: "0xpool",
  subgraphId: "0xpoolid",
  active: false,
  deprecated: true,
  activeStakingAddress: undefined,
  deprecatedStakingAddresses: [{ address: "0x8f702676830ddca2801a4a7cdb971cde4df697ae" }],
  rewards: { type: "single", rewardsInterval: "7 days", tokens: [{ ticker: "TEL", amount: 1_000 }] },
  links: { addLiquidity: "", poolAnalytics: "" },
  assets: [],
} as any;

const getTokenPrices = jest.fn();

beforeEach(() => {
  mockPoolBalanceOf.mockReset().mockResolvedValue(0n);
  mockStakeBalanceOf.mockReset().mockResolvedValue(0n);
  mockEarned.mockReset().mockResolvedValue(0n);
  getTokenPrices.mockReset().mockResolvedValue({});
  (getPoolLiquidityValue as jest.Mock).mockReset().mockResolvedValue(50_000);
  (getPoolContractValues as jest.Mock)
    .mockReset()
    .mockResolvedValue({ totalSupply: 100, totalStaked: 50, stakedLiquidity: 25_000, currentTotalStakeAmount: 50, poolContract: {} });
});

describe("balancerGetSingleContractData for an inactive pool", () => {
  it("makes no chain or price reads without a wallet, and carries no live figures", async () => {
    const data = await balancerGetSingleContractData(telUsdc, undefined, getTokenPrices, { metrics: { volume24h: 5 } } as any);
    expect(mockPoolBalanceOf).not.toHaveBeenCalled();
    expect(mockStakeBalanceOf).not.toHaveBeenCalled();
    expect(getPoolContractValues).not.toHaveBeenCalled();
    expect(getPoolLiquidityValue).not.toHaveBeenCalled();
    expect(getTokenPrices).not.toHaveBeenCalled();
    expect(data).toMatchObject({ totalLiquidity: null, dailyVolumeUSD: null, fees24hr: null, stakedLiquidity: null });
  });

  it("reads only the wallet's balances and rewards when the wallet has no stake", async () => {
    await balancerGetSingleContractData(telUsdc, WALLET, getTokenPrices, undefined);
    expect(mockStakeBalanceOf).toHaveBeenCalledWith(WALLET);
    expect(mockEarned).toHaveBeenCalledWith(WALLET);
    expect(getPoolContractValues).not.toHaveBeenCalled();
    expect(getTokenPrices).not.toHaveBeenCalled();
  });

  it("keeps a stake in the retired contract visible to Portfolio, with its value and claimable rewards", async () => {
    mockStakeBalanceOf.mockResolvedValue(5n * ONE);
    mockEarned.mockResolvedValue(1234n); // TEL has 2 decimals
    const data = await balancerGetSingleContractData(telUsdc, WALLET, getTokenPrices, undefined);

    expect(hasUserStake(data)).toBe(true);
    expect(Number(data.user.deprecated?.stakedLPT)).toBe(5);
    expect(data.user.deprecated?.stakedUSD).toBe(2_500);
    expect(data.user.deprecated?.rewards[0].unclaimed).toBe(12.34);
    expect(getTokenPrices).toHaveBeenCalledTimes(1);
    expect(getPoolLiquidityValue).toHaveBeenCalledTimes(1);
    expect(data.totalLiquidity).toBeNull();
  });
});
