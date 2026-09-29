import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData, hasUserStake } from "./contractsSlice";

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
        { contracts: [pool({ totalLiquidity: null, stakedLiquidity: null, dailyVolumeUSD: null, fees24hr: null })], meta },
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
            pool({ totalLiquidity: 10, stakedLiquidity: 0, dailyVolumeUSD: 0, fees24hr: null }),
            pool({ poolContractAddress: "0xdef", totalLiquidity: null, stakedLiquidity: null, dailyVolumeUSD: null, fees24hr: null }),
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
        { contracts: [pool({ totalLiquidity: 10, stakedLiquidity: 5, dailyVolumeUSD: 3, fees24hr: 1 })], meta },
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
