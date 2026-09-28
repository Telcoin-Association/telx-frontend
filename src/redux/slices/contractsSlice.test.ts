import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData } from "./contractsSlice";

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
