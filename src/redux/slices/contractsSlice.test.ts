import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData, hasUnclaimedRewards, hasUserStake, stakedLiquidityOf, subscribedTotal } from "./contractsSlice";
import { getSubscribedValue } from "../../helpers/poolRewardsDisplay";

const meta = { fetchedAt: 1, indexedAt: 1, hasIndexingErrors: false, sources: {} };

const pool = (overrides: Record<string, unknown>): any => ({
  poolContractAddress: "0xabc",
  blockchain: "polygon",
  protocol: "uniswap",
  active: true,
  user: {},
  ...overrides,
});

const makeStore = () => configureStore({ reducer: { contracts: contractsReducer } });

describe("contractsSlice totals", () => {
  it("are null when no active pool has a value, and numbers otherwise", () => {
    const store = makeStore();
    store.dispatch(
      fetchAllContractData.fulfilled(
        { contracts: [pool({ totalLiquidity: null, rewardsStatus: null, subscribedTvlUSD: null, dailyVolumeUSD: null, fees24hr: null })], meta },
        "r1",
        undefined
      )
    );
    expect(store.getState().contracts).toMatchObject({
      totalLiquidityAll: null,
      stakedLiquidityAll: null,
      totalVolumeAll: null,
      totalFeesAll: null,
      hasFetchedData: true,
    });

    store.dispatch(
      fetchAllContractData.fulfilled(
        {
          contracts: [
            pool({ totalLiquidity: 10, rewardsStatus: "LIVE", subscribedTvlUSD: 0, dailyVolumeUSD: 0, fees24hr: null }),
            pool({ poolContractAddress: "0xdef", totalLiquidity: null, rewardsStatus: null, subscribedTvlUSD: null, dailyVolumeUSD: null, fees24hr: null }),
          ],
          meta,
        },
        "r2",
        undefined
      )
    );
    expect(store.getState().contracts).toMatchObject({
      totalLiquidityAll: 10,
      stakedLiquidityAll: 0,
      totalVolumeAll: 0,
      totalFeesAll: null,
    });
  });
});

describe("contractsSlice staked total", () => {
  const stakedAll = (contracts: unknown[]) => {
    const store = makeStore();
    store.dispatch(fetchAllContractData.fulfilled({ contracts: contracts as any, meta }, "r", undefined));
    return store.getState().contracts.stakedLiquidityAll;
  };
  const live = (address: string, subscribedTvlUSD: number | null) =>
    pool({ poolContractAddress: address, rewardsStatus: "LIVE", subscribedTvlUSD, stakedLiquidity: null });

  it("sums subscribed TVL over active pools with a live campaign", () => {
    expect(stakedAll([live("0x1", 92_647), live("0x2", 46_546), live("0x3", 44_552)])).toBe(183_745);
  });

  it("leaves out scheduled, ended and unknown campaigns and inactive pools", () => {
    expect(
      stakedAll([
        live("0x1", 100),
        pool({ poolContractAddress: "0x2", rewardsStatus: "SOON", subscribedTvlUSD: 50 }),
        pool({ poolContractAddress: "0x3", rewardsStatus: "PAST", subscribedTvlUSD: 25 }),
        pool({ poolContractAddress: "0x4", rewardsStatus: null, subscribedTvlUSD: 10 }),
        pool({ poolContractAddress: "0x5", rewardsStatus: "LIVE", subscribedTvlUSD: 7, active: false }),
      ]),
    ).toBe(100);
  });

  it("is null, not 0, when no active pool has a live campaign with a subscribed TVL", () => {
    expect(stakedAll([pool({ rewardsStatus: null, subscribedTvlUSD: null, stakedLiquidity: null })])).toBeNull();
    expect(stakedAll([pool({ rewardsStatus: "SOON", subscribedTvlUSD: null }), pool({ poolContractAddress: "0x2", rewardsStatus: "PAST" })])).toBeNull();
    expect(stakedAll([live("0x1", null)])).toBeNull();
    expect(stakedAll([])).toBeNull();
  });

  it("keeps a live campaign's real zero", () => {
    expect(stakedAll([live("0x1", 0)])).toBe(0);
  });

  it("uses the staking contract value for pools that have one, and null when it is unknown", () => {
    expect(stakedLiquidityOf({ protocol: "quickswap", stakedLiquidity: 12 })).toBe(12);
    expect(stakedLiquidityOf({ protocol: "quickswap", stakedLiquidity: null })).toBeNull();
    expect(stakedLiquidityOf({ protocol: "balancer" })).toBeNull();
    expect(stakedLiquidityOf({ protocol: "uniswap", stakedLiquidity: 9, rewardsStatus: null })).toBeNull();
  });
});

describe("the one Subscribed Value Locked rule", () => {
  const END = 10_000;
  // Every case the SVL cells distinguish, each fed to the total and to the cells.
  const cases = [
    pool({ rewardsStatus: "LIVE", subscribedTvlUSD: 100, totalLiquidity: 400 }),
    pool({ rewardsStatus: "LIVE", subscribedTvlUSD: null }),
    pool({ rewardsStatus: "LIVE", subscribedTvlUSD: "250" }),
    pool({ rewardsStatus: "LIVE", subscribedTvlUSD: 70, rewardsCampaignEnd: END }),
    pool({ rewardsStatus: "SOON", subscribedTvlUSD: 5 }),
    pool({ rewardsStatus: "PAST", subscribedTvlUSD: 5 }),
    pool({ rewardsStatus: null, subscribedTvlUSD: 5 }),
    pool({ rewardsKnown: false, rewardsStatus: null, subscribedTvlUSD: null }),
  ];

  it.each([END - 1, END])("adds to the total exactly what the cells show as a value, at %s", (now) => {
    for (const contract of cases) {
      const cell = getSubscribedValue(contract, now);
      expect(stakedLiquidityOf(contract, now)).toBe(cell.kind === "value" ? cell.usd : null);
    }
  });

  it("drops a campaign from the total once it ends, without a new load", () => {
    expect(subscribedTotal([cases[0], cases[3]], END - 1).total).toBe(170);
    expect(subscribedTotal([cases[0], cases[3]], END).total).toBe(100);
  });

  it("names the chains whose subscribed value is unavailable, so the total can say it is partial", () => {
    const base = pool({ blockchain: "base", rewardsKnown: false, rewardsStatus: null });
    expect(subscribedTotal([cases[0], base])).toEqual({ total: 100, partialChains: ["base"] });
    expect(subscribedTotal([cases[0], cases[6]])).toEqual({ total: 100, partialChains: [] });
  });

  it("is null, not 0, when no pool has a value", () => {
    expect(subscribedTotal([cases[4], cases[5]]).total).toBeNull();
  });
});

describe("contractsSlice request ordering", () => {
  it("ignores the rejection and the result of a superseded request", () => {
    const store = makeStore();
    store.dispatch(fetchAllContractData.pending("old", undefined));
    store.dispatch(fetchAllContractData.pending("new", "0xabc"));

    store.dispatch(fetchAllContractData.rejected(new Error("rpc 429"), "old", undefined));
    expect(store.getState().contracts).toMatchObject({ loading: true, lastError: null, failedAttempts: 0 });

    store.dispatch(fetchAllContractData.fulfilled({ contracts: [], meta }, "old", undefined));
    expect(store.getState().contracts).toMatchObject({ loading: true, hasFetchedData: false });

    store.dispatch(fetchAllContractData.rejected(new Error("boom"), "new", "0xabc"));
    expect(store.getState().contracts).toMatchObject({ loading: false, lastError: "boom", failedAttempts: 1 });
  });
});

describe("contractsSlice failed refetch", () => {
  it("keeps the contracts, totals and freshness already loaded when a refetch rejects", () => {
    const store = makeStore();
    store.dispatch(fetchAllContractData.pending("r1", undefined));
    store.dispatch(
      fetchAllContractData.fulfilled(
        { contracts: [pool({ totalLiquidity: 10, rewardsStatus: "LIVE", subscribedTvlUSD: 5, dailyVolumeUSD: 3, fees24hr: 1 })], meta },
        "r1",
        undefined,
      ),
    );
    const loaded = store.getState().contracts;

    store.dispatch(fetchAllContractData.pending("r2", undefined));
    store.dispatch(fetchAllContractData.rejected(new Error("Pool data could not be loaded (uniswap-base)"), "r2", undefined));

    const after = store.getState().contracts;
    expect(after.contracts).toBe(loaded.contracts);
    expect(after).toMatchObject({
      totalLiquidityAll: 10,
      stakedLiquidityAll: 5,
      totalVolumeAll: 3,
      totalFeesAll: 1,
      dataFreshness: meta,
      hasFetchedData: true,
      lastError: "Pool data could not be loaded (uniswap-base)",
      failedAttempts: 1,
    });
  });
});

describe("contractsSlice user stakes", () => {
  it("keeps a pool whose stake is gone but whose rewards are still unclaimed", () => {
    const store = makeStore();
    const withdrawn = pool({
      poolContractAddress: "0xwithdrawn",
      protocol: "balancer",
      active: false,
      user: { stakedLPT: 0, deprecated: null },
      rewards: [{ ticker: "TEL", unclaimed: "42.5" }],
    });
    const empty = pool({ poolContractAddress: "0xempty", protocol: "balancer", active: false, user: { stakedLPT: 0 }, rewards: [{ ticker: "TEL", unclaimed: 0 }] });
    store.dispatch(fetchAllContractData.fulfilled({ contracts: [withdrawn, empty], meta }, "r1", undefined));
    expect(Object.values(store.getState().contracts.userContracts)).toEqual([withdrawn]);
  });

  it("counts unclaimed rewards in a retired staking contract", () => {
    expect(hasUnclaimedRewards({ user: { deprecated: { rewards: [{ unclaimed: "1" }] } } })).toBe(true);
    expect(hasUnclaimedRewards({ rewards: [{ unclaimed: 0 }], user: { deprecated: { rewards: [] } } })).toBe(false);
    expect(hasUnclaimedRewards({})).toBe(false);
  });

  it("keeps a stake in an inactive, deprecated pool reachable and out of the totals", () => {
    const store = makeStore();
    const retired = pool({
      poolContractAddress: "0x80tel20usdc",
      protocol: "balancer",
      active: false,
      deprecated: true,
      totalLiquidity: 500,
      user: { stakedLPT: "121404.36", deprecated: null },
    });
    const live = pool({ totalLiquidity: 10, user: { stakedLPT: 0 } });
    store.dispatch(fetchAllContractData.fulfilled({ contracts: [retired, live], meta }, "r1", undefined));

    const state = store.getState().contracts;
    expect(Object.values(state.userContracts)).toEqual([retired]);
    expect(Object.values(state.deprecatedPools)).toEqual([retired]);
    expect(state.totalLiquidityAll).toBe(10);
  });

  it("counts a stake in a retired staking contract of an active pool", () => {
    const store = makeStore();
    const active = pool({ protocol: "balancer", user: { stakedLPT: 0, deprecated: { stakedLPT: "5", balanceLPT: 0, stakedUSD: 0 } } });
    store.dispatch(fetchAllContractData.fulfilled({ contracts: [active], meta }, "r1", undefined));
    expect(Object.values(store.getState().contracts.userContracts)).toEqual([active]);
  });

  it("recognises stakes in every numeric form and ignores empty ones", () => {
    expect(hasUserStake({ user: { stakedLPT: 1n } })).toBe(true);
    expect(hasUserStake({ user: { stakedLPT: "0.5" } })).toBe(true);
    expect(hasUserStake({ user: { deprecated: { stakedLPT: 2 } } })).toBe(true);
    for (const stakedLPT of [0, "0", "", null, undefined, 0n, "abc"]) {
      expect(hasUserStake({ user: { stakedLPT, deprecated: null } })).toBe(false);
    }
    expect(hasUserStake({})).toBe(false);
  });
});

describe("contractsSlice background loads", () => {
  const background = { address: undefined, background: true } as const;

  it("shows no spinner while a background load runs", () => {
    const store = makeStore();
    store.dispatch(fetchAllContractData.fulfilled({ contracts: [pool({ totalLiquidity: 5 })], meta }, "r1", undefined));
    store.dispatch(fetchAllContractData.pending("r2", background));
    expect(store.getState().contracts.loading).toBe(false);
  });

  it("keeps the data and reports no error when a background load fails", () => {
    const store = makeStore();
    store.dispatch(fetchAllContractData.fulfilled({ contracts: [pool({ totalLiquidity: 5 })], meta }, "r1", undefined));
    store.dispatch(fetchAllContractData.pending("r2", background));
    store.dispatch(fetchAllContractData.rejected(new Error("down"), "r2", background));
    expect(store.getState().contracts).toMatchObject({ totalLiquidityAll: 5, lastError: null, failedAttempts: 0, loading: false });
  });

  it("records when the data on screen was loaded", () => {
    const store = makeStore();
    expect(store.getState().contracts.loadedAt).toBeNull();
    const before = Date.now();
    store.dispatch(fetchAllContractData.fulfilled({ contracts: [pool({})], meta }, "r1", background));
    expect(store.getState().contracts.loadedAt).toBeGreaterThanOrEqual(before);
  });
});

