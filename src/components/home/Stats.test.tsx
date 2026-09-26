import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData } from "@/redux/slices/contractsSlice";
import { DataFreshness } from "@/types/PoolMetrics";
import StatsCards from "./Stats";

jest.mock("../../web3/getContracts/shared", () => ({ getAllContractData: jest.fn() }));
jest.mock("../common/LoadingAnimationCircle", () => function LoadingAnimation() {
  return <span>loading</span>;
});

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const MIN = 60_000;

function renderWith(meta: DataFreshness) {
  const store = configureStore({ reducer: { contracts: contractsReducer } });
  store.dispatch(fetchAllContractData.fulfilled({ contracts: [], meta }, "req", undefined));
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

  it("reports indexing errors and renders nothing without a fetch time", () => {
    renderWith({ fetchedAt: null, indexedAt: null, hasIndexingErrors: true, sources: {} });
    expect(screen.getByText("Subgraph reported indexing errors")).toBeInTheDocument();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });
});
