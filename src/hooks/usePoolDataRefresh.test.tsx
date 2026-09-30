import React from "react";
import { act, render } from "@testing-library/react";
import { usePoolDataRefresh, POOL_REFRESH_CHECK_MS, POOL_REFRESH_INTERVAL_MS } from "./usePoolDataRefresh";

const mockDispatch = jest.fn();
const mockState = { hasFetchedData: true, loadedAt: 0 as number | null, loading: false, lastError: null as string | null, failedAttempts: 0 };

jest.mock("../redux/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector({ contracts: mockState }),
}));
jest.mock("../redux/slices/contractsSlice", () => ({
  fetchAllContractData: (load: unknown) => ({ type: "load", load }),
  hasFetchedDataSelector: (s: any) => s.contracts.hasFetchedData,
  loadedAtSelector: (s: any) => s.contracts.loadedAt,
  contractsLoadingSelector: (s: any) => s.contracts.loading,
  contractsErrorSelector: (s: any) => s.contracts.lastError,
  failedAttemptsSelector: (s: any) => s.contracts.failedAttempts,
  LOAD_RETRY_DELAYS_MS: [5_000, 30_000, 120_000],
}));

function Harness({ address }: { address?: string }) {
  usePoolDataRefresh(address);
  return null;
}

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (value: DocumentVisibilityState) => {
  visibility = value;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};
const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeAll(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(Date.UTC(2026, 8, 29, 12));
  visibility = "visible";
  mockDispatch.mockReset();
  Object.assign(mockState, { hasFetchedData: true, loadedAt: Date.now(), loading: false, lastError: null, failedAttempts: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("usePoolDataRefresh", () => {
  it("refreshes in the background once the data is five minutes old", () => {
    render(<Harness address="0xabc" />);
    advance(POOL_REFRESH_INTERVAL_MS - POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).not.toHaveBeenCalled();
    advance(POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({ type: "load", load: { address: "0xabc", background: true } });
  });

  it("does not refresh while the tab is hidden, and refreshes at once when it becomes visible", () => {
    render(<Harness />);
    setVisibility("hidden");
    advance(3 * POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("does not refresh fresh data when the tab becomes visible", () => {
    render(<Harness />);
    setVisibility("hidden");
    setVisibility("visible");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("waits while a load is in flight or a failed load is being retried", () => {
    mockState.loading = true;
    const { rerender } = render(<Harness />);
    advance(2 * POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).not.toHaveBeenCalled();

    Object.assign(mockState, { loading: false, lastError: "down", failedAttempts: 3 });
    rerender(<Harness />);
    advance(POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("takes over again once a failed load has used up its retries", () => {
    Object.assign(mockState, { lastError: "down", failedAttempts: 4 });
    render(<Harness address="0xabc" />);
    advance(POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).toHaveBeenCalledWith({ type: "load", load: { address: "0xabc", background: true } });
  });

  it("tries a failed refresh again one interval later, not on every check", () => {
    render(<Harness />);
    advance(POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    advance(POOL_REFRESH_INTERVAL_MS - POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    advance(POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("does nothing before the first load", () => {
    mockState.hasFetchedData = false;
    render(<Harness />);
    advance(3 * POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
