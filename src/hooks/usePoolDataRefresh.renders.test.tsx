import React from "react";
import { act, render } from "@testing-library/react";
import { usePoolDataRefresh, POOL_REFRESH_CHECK_MS, POOL_REFRESH_INTERVAL_MS } from "./usePoolDataRefresh";

// These tests change the store and the address between renders, the way the app does: AppLayout mounts while
// the first load is still running, and the wallet can change while the page is open. The timer reads them
// through a ref that each render rewrites, and these tests fail if that rewrite stops.

const mockDispatch = jest.fn();
const mockState = { hasFetchedData: true, loadedAt: 0 as number | null, loading: false, lastError: null as string | null };

jest.mock("../redux/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector({ contracts: mockState }),
}));
jest.mock("../redux/slices/contractsSlice", () => ({
  fetchAllContractData: (load: unknown) => ({ type: "load", load }),
  hasFetchedDataSelector: (s: { contracts: typeof mockState }) => s.contracts.hasFetchedData,
  loadedAtSelector: (s: { contracts: typeof mockState }) => s.contracts.loadedAt,
  contractsLoadingSelector: (s: { contracts: typeof mockState }) => s.contracts.loading,
  contractsErrorSelector: (s: { contracts: typeof mockState }) => s.contracts.lastError,
}));

function Harness({ address }: { address?: string }) {
  usePoolDataRefresh(address);
  return null;
}

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeAll(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(Date.UTC(2026, 8, 29, 12));
  mockDispatch.mockReset();
  Object.assign(mockState, { hasFetchedData: true, loadedAt: Date.now(), loading: false, lastError: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("usePoolDataRefresh across renders", () => {
  it("starts refreshing once a load that was in flight at mount finishes", () => {
    mockState.loading = true;
    const { rerender } = render(<Harness />);
    advance(POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).not.toHaveBeenCalled();

    mockState.loading = false;
    rerender(<Harness />);
    advance(POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("refreshes for the address of the latest render", () => {
    const { rerender } = render(<Harness address="0xold" />);
    rerender(<Harness address="0xnew" />);
    advance(POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).toHaveBeenCalledWith({ type: "load", load: { address: "0xnew", background: true } });
  });

  it("counts the interval from the latest load, not the one seen at mount", () => {
    const { rerender } = render(<Harness />);
    advance(POOL_REFRESH_INTERVAL_MS - POOL_REFRESH_CHECK_MS);
    mockState.loadedAt = Date.now();
    rerender(<Harness />);
    advance(POOL_REFRESH_CHECK_MS);
    expect(mockDispatch).not.toHaveBeenCalled();
    advance(POOL_REFRESH_INTERVAL_MS);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});
