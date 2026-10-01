import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData } from "../../redux/slices/contractsSlice";
import PoolDataAge from "./PoolDataAge";

jest.mock("../../web3/getContracts/shared", () => ({ getAllContractData: jest.fn() }));

const NOW = Date.UTC(2026, 8, 30, 12);
const MIN = 60_000;
const polygonPool = { protocol: "uniswap", blockchain: "polygon", active: true };

function renderAge(fetchedAt: number, { refreshFails = false, pool = polygonPool } = {}) {
  const store = configureStore({ reducer: { contracts: contractsReducer } });
  const meta = { fetchedAt, indexedAt: fetchedAt, hasIndexingErrors: false, sources: { "uniswap-polygon": { fetchedAt, indexedAt: fetchedAt, hasIndexingErrors: false } } };
  store.dispatch(fetchAllContractData.fulfilled({ contracts: [], meta }, "r1", undefined));
  if (refreshFails) {
    const background = { address: undefined, background: true } as const;
    store.dispatch(fetchAllContractData.pending("r2", background));
    store.dispatch(fetchAllContractData.rejected(new Error("down"), "r2", background));
  }
  return render(
    <Provider store={store}>
      <PoolDataAge pool={pool} />
    </Provider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe("PoolDataAge", () => {
  it("dates the figures by the pool's own chain data", () => {
    renderAge(NOW - 3 * MIN);
    expect(screen.getByText("Updated 3 min ago")).toHaveClass("text-primary");
  });

  it("turns the age amber only once the data is over 2 hours old", () => {
    const { unmount } = renderAge(NOW - 119 * MIN);
    expect(screen.getByText("Updated 1 hr ago")).not.toHaveClass("text-amber-400");
    unmount();
    renderAge(NOW - 125 * MIN);
    expect(screen.getByText("Updated 2 hr ago")).toHaveClass("text-amber-400");
  });

  it("says the figures may be out of date while background refreshes fail", () => {
    renderAge(NOW - 8 * MIN, { refreshFails: true });
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing pool data failed, so these figures may be out of date.");
  });

  it("shows nothing for an archived pool, which has no live figures", () => {
    renderAge(NOW - 45 * MIN, { pool: { ...polygonPool, active: false } });
    expect(screen.queryByTestId("pool-data-age")).not.toBeInTheDocument();
  });
});
