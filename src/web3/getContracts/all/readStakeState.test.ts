/**
 * @jest-environment node
 */
import { readStakeState, stakedValueUSD, stakeShare } from "./readStakeState";
import { getPoolContractValues } from "./getPoolContractValues";

const mockPoolBalanceOf = jest.fn();

jest.mock("ethers", () => {
  const actual = jest.requireActual("ethers");
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: jest.fn(() => ({ balanceOf: mockPoolBalanceOf })) },
  };
});
jest.mock("../../../lib/ethersProvider", () => ({ provider: {} }));
jest.mock("./getPoolContractValues", () => ({ getPoolContractValues: jest.fn() }));

const WALLET = "0x00000000000000000000000000000000000000aa";
const ONE = 10n ** 18n;
const stakeBalanceOf = jest.fn();
const stakeContract = { balanceOf: stakeBalanceOf } as any;
const totalsFromChain = { totalSupply: 100, totalStaked: 40, stakedLiquidity: 4_000, currentTotalStakeAmount: 40 };

const read = (overrides: Partial<Parameters<typeof readStakeState>[0]> = {}) =>
  readStakeState({
    poolAddress: "0xpool",
    stakeAddress: "0xstake",
    stakeContract,
    wallet: undefined,
    includeTotals: false,
    totalLiquidity: jest.fn().mockResolvedValue(10_000),
    ...overrides,
  });

beforeEach(() => {
  mockPoolBalanceOf.mockReset().mockResolvedValue(0n);
  stakeBalanceOf.mockReset().mockResolvedValue(0n);
  (getPoolContractValues as jest.Mock).mockReset().mockResolvedValue({ ...totalsFromChain, poolContract: {} });
});

describe("readStakeState", () => {
  it("reads nothing for an inactive pool without a wallet", async () => {
    const totalLiquidity = jest.fn();
    const state = await read({ totalLiquidity });
    expect(state).toMatchObject({ walletLPT: 0, walletStakedLPT: 0, totals: null });
    expect(mockPoolBalanceOf).not.toHaveBeenCalled();
    expect(stakeBalanceOf).not.toHaveBeenCalled();
    expect(getPoolContractValues).not.toHaveBeenCalled();
    expect(totalLiquidity).not.toHaveBeenCalled();
  });

  it("reads only the wallet's balances for an inactive pool the wallet has no stake in", async () => {
    mockPoolBalanceOf.mockResolvedValue(3n * ONE);
    const state = await read({ wallet: WALLET });
    expect(state).toMatchObject({ walletLPT: 3, walletStakedLPT: 0, totals: null });
    expect(mockPoolBalanceOf).toHaveBeenCalledWith(WALLET);
    expect(stakeBalanceOf).toHaveBeenCalledWith(WALLET);
    expect(getPoolContractValues).not.toHaveBeenCalled();
  });

  it("reads the totals, priced from the pool's liquidity, when the wallet has a stake to value", async () => {
    stakeBalanceOf.mockResolvedValue(4n * ONE);
    const totalLiquidity = jest.fn().mockResolvedValue(10_000);
    const state = await read({ wallet: WALLET, totalLiquidity });
    expect(totalLiquidity).toHaveBeenCalledTimes(1);
    expect(getPoolContractValues).toHaveBeenCalledWith(expect.objectContaining({ totalLiquidity: 10_000 }));
    expect(state.walletStakedLPT).toBe(4);
    expect(state.totals).toEqual(totalsFromChain);
  });

  it("reads the totals of an active pool without a wallet", async () => {
    const state = await read({ includeTotals: true });
    expect(state.totals).toEqual(totalsFromChain);
    expect(mockPoolBalanceOf).not.toHaveBeenCalled();
  });

  it("treats a failed wallet read as no balance instead of failing the load", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    stakeBalanceOf.mockRejectedValue(new Error("rpc down"));
    const state = await read({ wallet: WALLET });
    expect(state).toMatchObject({ walletLPT: 0, walletStakedLPT: 0, totals: null });
  });
});

describe("stake share and value", () => {
  it("are 0 without totals, and proportional with them", () => {
    expect(stakeShare(4, null)).toBe(0);
    expect(stakedValueUSD(4, null)).toBe(0);
    expect(stakeShare(4, totalsFromChain)).toBe(0.1);
    expect(stakedValueUSD(4, totalsFromChain)).toBe(400);
  });

  it("are 0 rather than NaN when nothing is staked or the liquidity is unknown", () => {
    const empty = { ...totalsFromChain, totalStaked: 0, currentTotalStakeAmount: 0 };
    expect(stakeShare(0, empty)).toBe(0);
    expect(stakedValueUSD(0, empty)).toBe(0);
    expect(stakedValueUSD(4, { ...totalsFromChain, stakedLiquidity: null })).toBe(0);
  });
});
