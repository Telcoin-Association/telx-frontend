import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData } from "@/redux/slices/contractsSlice";
import { DataFreshness } from "@/types/PoolMetrics";
import StatsCards, { formatDuration, partialTotalsNote } from "./Stats";

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
  stakedLiquidity: null,
  rewardsStatus: "LIVE",
  subscribedTvlUSD: 0,
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

// The note's age and group lines, in the order they render.
const noteLines = () => screen.queryAllByText(/^Updated |^[A-Za-z]+ data is /).map((line) => line.textContent);


// The tooltip trigger whose visible text starts with `text`: the element that carries aria-describedby.
const describedTrigger = (text: string) =>
  screen.getByText((_, el) => !!el?.hasAttribute("aria-describedby") && !!el.textContent?.startsWith(text));

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
    expect(screen.getByText("Updated 1 min ago")).toBeInTheDocument();
    expect(screen.getByText("QuickSwap data is 50 min old")).toBeInTheDocument();
    expect(screen.getByText("Subgraph data is 40 min behind")).toBeInTheDocument();
  });

  it("dates the stats by the newest group and names the stale ones", () => {
    const DAY = 24 * 60 * MIN;
    renderWith({
      fetchedAt: NOW - 7 * DAY - 43 * MIN,
      indexedAt: NOW - 4 * MIN,
      hasIndexingErrors: false,
      sources: {
        "uniswap-polygon": { fetchedAt: NOW - 7 * DAY - 43 * MIN, indexedAt: null, hasIndexingErrors: false },
        "uniswap-base": { fetchedAt: NOW - 3 * MIN, indexedAt: NOW - 4 * MIN, hasIndexingErrors: false },
        "uniswap-ethereum": { fetchedAt: NOW - 3 * MIN, indexedAt: NOW - 4 * MIN, hasIndexingErrors: false },
      },
    });
    expect(screen.getByText("Updated 3 min ago")).toBeInTheDocument();
    expect(screen.getByText("Polygon data is 7 days old")).toBeInTheDocument();
    expect(screen.queryByText(/Base data/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ethereum data/)).not.toBeInTheDocument();
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  it("names nothing when every group is recent", () => {
    renderWith({
      fetchedAt: NOW - 9 * MIN,
      indexedAt: NOW - 10 * MIN,
      hasIndexingErrors: false,
      sources: {
        "uniswap-polygon": { fetchedAt: NOW - 9 * MIN, indexedAt: NOW - 10 * MIN, hasIndexingErrors: false },
        "uniswap-base": { fetchedAt: NOW - 2 * MIN, indexedAt: NOW - 3 * MIN, hasIndexingErrors: false },
        "uniswap-ethereum": { fetchedAt: NOW - 5 * MIN, indexedAt: NOW - 6 * MIN, hasIndexingErrors: false },
      },
    });
    expect(screen.getAllByText(/^Updated .* ago$/)).toHaveLength(1);
    expect(screen.getByText("Updated 2 min ago")).toBeInTheDocument();
    expect(screen.queryByText(/ data is /)).not.toBeInTheDocument();
  });

  it("shows a stale fetch in hours or days rather than a pile of minutes", () => {
    const DAY = 24 * 60 * MIN;
    renderWith({ fetchedAt: NOW - 7 * DAY - 43 * MIN, indexedAt: NOW - 7 * DAY - 43 * MIN, hasIndexingErrors: false, sources: {} });
    expect(screen.getByText("Updated 7 days ago")).toBeInTheDocument();
    expect(screen.queryByText(/min ago/)).not.toBeInTheDocument();
  });

  it("names a group that failed to load beside the fresh ones", () => {
    const fresh = (age: number) => ({ fetchedAt: NOW - age, indexedAt: NOW - age, hasIndexingErrors: false });
    renderWith({
      ...fresh(3 * MIN),
      sources: { "uniswap-base": fresh(2 * MIN), "uniswap-ethereum": fresh(3 * MIN) },
      failed: ["uniswap-polygon"],
    });
    expect(noteLines()).toEqual(["Updated 2 min ago", "Polygon data is unavailable"]);
  });

  it("still renders when every active group failed to load", () => {
    renderWith({
      fetchedAt: null,
      indexedAt: null,
      hasIndexingErrors: null,
      sources: {},
      failed: ["uniswap-polygon", "uniswap-base"],
    });
    expect(noteLines()).toEqual(["Base data is unavailable", "Polygon data is unavailable"]);
  });

  it("reports indexing errors and renders nothing without a fetch time", () => {
    renderWith({ fetchedAt: null, indexedAt: null, hasIndexingErrors: true, sources: {} });
    expect(screen.getByText("Subgraph reported indexing errors")).toBeInTheDocument();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  it("shows Unavailable, not $0, when a load completes with no values", () => {
    renderWith({ fetchedAt: NOW, indexedAt: NOW, hasIndexingErrors: false, sources: {} }, [
      { ...zeroPool, totalLiquidity: null, rewardsStatus: null, subscribedTvlUSD: null, dailyVolumeUSD: null, fees24hr: null },
    ]);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
  });

  it("shows Subscribed Value Locked as Unavailable, not $0, when the pools loaded without rewards data", () => {
    renderWith({ fetchedAt: NOW, indexedAt: NOW, hasIndexingErrors: false, sources: {} }, [
      { ...zeroPool, totalLiquidity: 150_000, dailyVolumeUSD: 1_000, fees24hr: 3, rewardsStatus: null, subscribedTvlUSD: null },
    ]);
    expect(screen.getByText("$150,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(1);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("shows the subscribed TVL of live campaigns as Subscribed Value Locked, next to TVL", () => {
    renderWith({ fetchedAt: NOW, indexedAt: NOW, hasIndexingErrors: false, sources: {} }, [
      { ...zeroPool, poolContractAddress: "0x1", subscribedTvlUSD: 92_647 },
      { ...zeroPool, poolContractAddress: "0x2", subscribedTvlUSD: 46_546 },
      { ...zeroPool, poolContractAddress: "0x3", rewardsStatus: "SOON", subscribedTvlUSD: null },
    ]);
    expect(screen.getByText("$139,193.00")).toBeInTheDocument();
    expect(screen.getByText("Subscribed Value Locked")).toBeInTheDocument();
    expect(screen.getByText("TVL")).toBeInTheDocument();
    expect(screen.queryByText("Staked")).not.toBeInTheDocument();
  });

  it("marks the totals as partial while an active group is missing", () => {
    const fresh = { fetchedAt: NOW - MIN, indexedAt: NOW - MIN, hasIndexingErrors: false };
    renderWith({ ...fresh, sources: { "uniswap-base": fresh }, failed: ["uniswap-polygon"] }, [{ ...zeroPool, totalLiquidity: 10 }]);
    expect(screen.getAllByText("partial")).toHaveLength(4);
    const note = "Partial total: excludes Polygon pools, whose data is unavailable";
    const tips = screen.getAllByRole("tooltip");
    expect(tips).toHaveLength(4);
    tips.forEach(tip => expect(tip).toHaveTextContent(note));
    expect(describedTrigger("$10.00")).toHaveAccessibleDescription(note);
  });

  it("does not mark the totals when every active group loaded", () => {
    renderWith({ fetchedAt: NOW, indexedAt: NOW, hasIndexingErrors: false, sources: {}, failed: [] });
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
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

describe("partialTotalsNote", () => {
  const base = { fetchedAt: 1, indexedAt: 1, hasIndexingErrors: false, sources: {} };

  it("is null when no group failed", () => {
    expect(partialTotalsNote(null)).toBeNull();
    expect(partialTotalsNote(base)).toBeNull();
    expect(partialTotalsNote({ ...base, failed: [] })).toBeNull();
  });

  it("names the missing groups in label order", () => {
    expect(partialTotalsNote({ ...base, failed: ["uniswap-ethereum", "uniswap-base"] })).toBe(
      "Partial total: excludes Base and Ethereum pools, whose data is unavailable",
    );
    expect(partialTotalsNote({ ...base, failed: ["quickswap", "uniswap-ethereum", "uniswap-base"] })).toBe(
      "Partial total: excludes Base, Ethereum and QuickSwap pools, whose data is unavailable",
    );
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
