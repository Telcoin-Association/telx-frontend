/**
 * @jest-environment node
 */
import { quickswapGetStakeInfo } from "./getStakeInfo";
import { readStakeState } from "../all/readStakeState";
import { createStakingContract } from "../all/createStakingContract";

jest.mock("../all/createStakingContract", () => ({ createStakingContract: jest.fn() }));
jest.mock("../all/readStakeState", () => ({
  ...jest.requireActual("../all/readStakeState"),
  readStakeState: jest.fn(),
}));

const value = { active: false, rewards: { tokens: [{ ticker: "TEL", amount: 100 }] } } as any;
const earnedA = jest.fn();
const earnedB = jest.fn();

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  earnedA.mockReset().mockResolvedValue(250n);
  earnedB.mockReset().mockResolvedValue(0n);
  (createStakingContract as jest.Mock).mockResolvedValue({ earnedA, earnedB });
  (readStakeState as jest.Mock).mockResolvedValue({ poolContract: {}, walletLPT: 0, walletStakedLPT: 2, walletReadFailed: false, totals: null });
});

afterEach(() => jest.restoreAllMocks());

const read = () => quickswapGetStakeInfo("0xstake", "0xpool", "multi", async () => null, value, "0xwallet");

describe("quickswapGetStakeInfo", () => {
  it("reads the wallet's unclaimed rewards", async () => {
    const info = await read();
    expect(info.rewards[0].unclaimed).toBe(2.5);
    expect(info.readFailed).toBe(false);
  });

  it("marks a failed rewards read instead of failing the whole load", async () => {
    earnedA.mockRejectedValue(new Error("rpc down"));
    const info = await read();
    expect(info.readFailed).toBe(true);
    expect(info.stakedLPT).toBe((2).toFixed(18));
  });

  it("marks a failed stake read", async () => {
    (readStakeState as jest.Mock).mockResolvedValue({ poolContract: {}, walletLPT: 0, walletStakedLPT: 0, walletReadFailed: true, totals: null });
    expect((await read()).readFailed).toBe(true);
  });
});
