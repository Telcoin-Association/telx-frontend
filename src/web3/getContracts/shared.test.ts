import { getAllContractData, resetEmptyLegacyPools, walletHasNothingIn } from "./shared";
import type { miningContract } from "../../helpers/normalizeMiningContracts";

const mockBalancer = jest.fn();
const mockQuickswap = jest.fn();
const mockUniswap = jest.fn();

jest.mock("./balancer/getSingleContractData", () => ({ balancerGetSingleContractData: (...args: unknown[]) => mockBalancer(...args) }));
jest.mock("./quickswap/getSingleContractData", () => ({ quickswapGetSingleContractData: (...args: unknown[]) => mockQuickswap(...args) }));
jest.mock("./dfx/getSingleContractData", () => ({ dfxGetSingleContractData: jest.fn() }));
jest.mock("./uniswapv4/getSingleContractData", () => ({ uniswapGetSingleContractData: (...args: unknown[]) => mockUniswap(...args) }));
jest.mock("../../helpers/getTokenPricesCached", () => ({ getTokenPricesCached: jest.fn() }));
jest.mock("../../helpers/prefetchPoolData", () => ({
  prefetchPoolData: async () => ({ uniswapById: {}, meta: { fetchedAt: 1, indexedAt: 1, hasIndexingErrors: false, sources: {} } }),
}));

const WALLET = "0x00000000000000000000000000000000000000Aa";
const pool = (protocol: string, address: string, active = false) =>
  ({ protocol, pool: address, blockchain: "polygon", active }) as unknown as miningContract;

const EMPTY_BALANCER = pool("balancer", "0xb1");
const HELD_BALANCER = pool("balancer", "0xb2");
const EMPTY_QUICKSWAP = pool("quickswap", "0xq1");
const ACTIVE_UNISWAP = pool("uniswap", "0xu1", true);
const POOLS = [EMPTY_BALANCER, HELD_BALANCER, EMPTY_QUICKSWAP, ACTIVE_UNISWAP];

const emptyUser = { user: { balanceLPT: 0, stakedLPT: 0 }, rewards: [] };
const heldUser = { user: { balanceLPT: 0, stakedLPT: "12.5" }, rewards: [] };

// Each reader reports whether it was given the wallet, and returns holdings only for the held pool.
function readerFor(held: string[]) {
  return async (value: miningContract, wallet: string | undefined) => ({
    pool: value.pool,
    wallet,
    ...(wallet && held.includes(String(value.pool)) ? heldUser : emptyUser),
  });
}

const walletsPassed = (mock: jest.Mock) => mock.mock.calls.map(([value, wallet]) => [value.pool, wallet]);

beforeEach(() => {
  resetEmptyLegacyPools();
  for (const mock of [mockBalancer, mockQuickswap, mockUniswap]) mock.mockReset().mockImplementation(readerFor(["0xb2"]));
});

describe("getAllContractData wallet reads for inactive legacy pools", () => {
  it("reads every pool for the wallet on a full load", async () => {
    await getAllContractData(POOLS, WALLET);
    expect(walletsPassed(mockBalancer)).toEqual([["0xb1", WALLET], ["0xb2", WALLET]]);
    expect(walletsPassed(mockQuickswap)).toEqual([["0xq1", WALLET]]);
  });

  it("skips, on a background refresh, the inactive legacy pools where the last full load found nothing", async () => {
    await getAllContractData(POOLS, WALLET);
    for (const mock of [mockBalancer, mockQuickswap, mockUniswap]) mock.mockClear();

    const { contracts } = await getAllContractData(POOLS, WALLET, { background: true });

    expect(walletsPassed(mockBalancer)).toEqual([["0xb1", undefined], ["0xb2", WALLET]]);
    expect(walletsPassed(mockQuickswap)).toEqual([["0xq1", undefined]]);
    // Active pools are always read for the wallet.
    expect(walletsPassed(mockUniswap)).toEqual([["0xu1", WALLET]]);
    // The held pool keeps its stake; the skipped ones read as empty, as they were.
    expect(contracts.map((c: any) => c.user.stakedLPT)).toEqual([0, "12.5", 0, 0]);
  });

  it("reads everything for a wallet whose full load has not run yet, and for another wallet", async () => {
    await getAllContractData(POOLS, WALLET, { background: true });
    expect(walletsPassed(mockBalancer)).toEqual([["0xb1", WALLET], ["0xb2", WALLET]]);

    await getAllContractData(POOLS, WALLET);
    mockBalancer.mockClear();
    const other = "0x00000000000000000000000000000000000000bb";
    await getAllContractData(POOLS, other, { background: true });
    expect(walletsPassed(mockBalancer)).toEqual([["0xb1", other], ["0xb2", other]]);
  });

  it("reads a pool again once a full load finds holdings in it", async () => {
    await getAllContractData(POOLS, WALLET);
    mockBalancer.mockImplementation(readerFor(["0xb1", "0xb2"]));
    await getAllContractData(POOLS, WALLET);
    mockBalancer.mockClear();

    await getAllContractData(POOLS, WALLET, { background: true });
    expect(walletsPassed(mockBalancer)).toEqual([["0xb1", WALLET], ["0xb2", WALLET]]);
  });
});

describe("walletHasNothingIn", () => {
  it("counts unstaked LP tokens, stakes and unclaimed rewards, in current and retired contracts", () => {
    expect(walletHasNothingIn(emptyUser)).toBe(true);
    expect(walletHasNothingIn({ user: { balanceLPT: "1" } })).toBe(false);
    expect(walletHasNothingIn({ user: { deprecated: { balanceLPT: 3 } } })).toBe(false);
    expect(walletHasNothingIn(heldUser)).toBe(false);
    expect(walletHasNothingIn({ user: {}, rewards: [{ unclaimed: "4" }] })).toBe(false);
  });
});
