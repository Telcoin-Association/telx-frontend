import React from "react";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import contractsReducer from "@/redux/slices/contractsSlice";
import { getAllContractData } from "@/web3/getContracts/shared";
import AppLayout from "./AppLayout";

jest.mock("../../web3/getContracts/shared", () => ({ getAllContractData: jest.fn() }));
jest.mock("wagmi", () => ({ useAccount: () => ({ address: undefined }) }));
jest.mock("next/navigation", () => ({ usePathname: () => "/" }));
jest.mock("@datadog/browser-rum", () => ({ datadogRum: { setUser: jest.fn() } }));
jest.mock("./Header", () => () => null);
jest.mock("./Footer", () => () => null);

const getAll = getAllContractData as jest.Mock;

// Let the thunk's promise chain settle and React re-run its effects.
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("AppLayout contract data retry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getAll.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it("retries a failed load after 5s, 30s and 2m, then stops", async () => {
    getAll.mockRejectedValue(new Error("rpc down"));
    const store = configureStore({ reducer: { contracts: contractsReducer } });

    render(
      <Provider store={store}>
        <AppLayout>{null}</AppLayout>
      </Provider>
    );
    await flush();
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(store.getState().contracts).toMatchObject({ hasFetchedData: false, lastError: "rpc down", failedAttempts: 1 });

    for (const [delay, calls] of [[5_000, 2], [30_000, 3], [120_000, 4]]) {
      await act(async () => {
        jest.advanceTimersByTime(delay - 1);
      });
      expect(getAll).toHaveBeenCalledTimes(calls - 1);
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      await flush();
      expect(getAll).toHaveBeenCalledTimes(calls);
    }

    await act(async () => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(getAll).toHaveBeenCalledTimes(4);
    expect(store.getState().contracts.failedAttempts).toBe(4);
  });

  it("resets the error and stores freshness once a retry succeeds", async () => {
    const meta = { fetchedAt: 1000, indexedAt: 900, hasIndexingErrors: false, sources: {} };
    getAll.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce({ contracts: [], meta });
    const store = configureStore({ reducer: { contracts: contractsReducer } });

    render(
      <Provider store={store}>
        <AppLayout>{null}</AppLayout>
      </Provider>
    );
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    await flush();

    expect(getAll).toHaveBeenCalledTimes(2);
    expect(store.getState().contracts).toMatchObject({
      hasFetchedData: true,
      lastError: null,
      failedAttempts: 0,
      dataFreshness: meta,
      // No active pool contributed a value, so the total is unknown rather than $0.
      totalVolumeAll: null,
    });
  });
});
