import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData } from "@/redux/slices/contractsSlice";
import { DataFreshness } from "@/types/PoolMetrics";
import StatsCards, { formatDuration } from "./Stats";

jest.mock("../../web3/getContracts/shared", () => ({ getAllContractData: jest.fn() }));
jest.mock("../common/LoadingAnimationCircle", () => function LoadingAnimation() {
  return <span>loading</span>;
});

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const MIN = 60_000;

function renderStore(store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <StatsCards />
    </Provider>
  );
}

function makeStore() {
  return configureStore({ reducer: { contracts: contractsReducer } });
}

const zeroPool = {
  poolContractAddress: "0xabc",
  blockchain: "polygon",
  protocol: "uniswap",
  active: true,
  user: {},
  totalLiquidity: 0,
  stakedLiquidity: 0,
  dailyVolumeUSD: 0,
  fees24hr: 0,
};

function renderWith(meta: DataFreshness, contracts: unknown[] = [zeroPool]) {
  const store = makeStore();
  store.dispatch(fetchAllContractData.fulfilled({ contracts: contracts as any, meta }, "req", undefined));
  return render(
    <Provider store={store}>
      <StatsCards />
    </Provider>
  );
}

describe("StatsCards data freshness", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it("shows the fetch age and updates it once a minute", () => {
    renderWith({ fetchedAt: NOW - 30_000, indexedAt: NOW - MIN, hasIndexingErrors: false, sources: {} });
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00")).toHaveLength(4);

    act(() => {
      jest.advanceTimersByTime(2 * MIN);
    });
    expect(screen.getByText("Updated 2 min ago")).toBeInTheDocument();
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
    expect(screen.queryByText(/indexing errors/)).not.toBeInTheDocument();
  });

  it("warns when one group's subgraph is more than 30 minutes behind its fetch", () => {
    // The oldest fetchedAt (quickswap) and oldest indexedAt (quickswap) are close, but
    // uniswap-base was fetched recently from a subgraph 40 minutes behind.
    renderWith({
      fetchedAt: NOW - 50 * MIN,
      indexedAt: NOW - 51 * MIN,
      hasIndexingErrors: false,
      sources: {
        quickswap: { fetchedAt: NOW - 50 * MIN, indexedAt: NOW - 51 * MIN, hasIndexingErrors: false },
        "uniswap-base": { fetchedAt: NOW - MIN, indexedAt: NOW - 41 * MIN, hasIndexingErrors: false },
      },
    });
    expect(screen.getByText("Updated 50 min ago")).toBeInTheDocument();
    expect(screen.getByText("Subgraph data is 40 min behind")).toBeInTheDocument();
  });

  it("shows a stale fetch in hours or days rather than a pile of minutes", () => {
    const DAY = 24 * 60 * MIN;
    renderWith({ fetchedAt: NOW - 7 * DAY - 43 * MIN, indexedAt: NOW - 7 * DAY - 43 * MIN, hasIndexingErrors: false, sources: {} });
    expect(screen.getByText("Updated 7 days ago")).toBeInTheDocument();
    expect(screen.queryByText(/min ago/)).not.toBeInTheDocument();
  });

  it("reports indexing errors and renders nothing without a fetch time", () => {
    renderWith({ fetchedAt: null, indexedAt: null, hasIndexingErrors: true, sources: {} });
    expect(screen.getByText("Subgraph reported indexing errors")).toBeInTheDocument();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  it("shows Unavailable, not $0, when a load completes with no values", () => {
    renderWith({ fetchedAt: NOW, indexedAt: NOW, hasIndexingErrors: false, sources: {} }, [
      { ...zeroPool, totalLiquidity: null, stakedLiquidity: null, dailyVolumeUSD: null, fees24hr: null },
    ]);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
  });

  it("says a failed load is retrying, then that it gave up", () => {
    const store = makeStore();
    const fail = () => store.dispatch(fetchAllContractData.rejected(new Error("boom"), "req", undefined));
    fail();
    renderStore(store);
    expect(screen.getByText("Loading pool data failed, retrying")).toBeInTheDocument();
    expect(screen.getAllByText("loading")).toHaveLength(4);

    act(() => {
      fail();
      fail();
      fail();
    });
    expect(screen.getByText("Pool data could not be loaded. Reload the page to try again.")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
  });
});

describe("formatDuration", () => {
  it("picks minutes, hours or days", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(59 * MIN)).toBe("59 min");
    expect(formatDuration(60 * MIN)).toBe("1 hr");
    expect(formatDuration(23 * 60 * MIN + 59 * MIN)).toBe("23 hr");
    expect(formatDuration(24 * 60 * MIN)).toBe("1 day");
    expect(formatDuration(10123 * MIN)).toBe("7 days");
  });
});
