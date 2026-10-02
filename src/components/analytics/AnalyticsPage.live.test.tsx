import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalyticsPage from "./AnalyticsPage";
import type { AnalyticsDay, AnalyticsResponse } from "../../lib/analytics";

/*
 * The live payload's shape: days in unix seconds, campaign windows in unix milliseconds, no TEL price, a last day
 * without rewards figures, Ethereum pools without any rewards rows, and a day whose SVL exceeds its TVL.
 */
const FIRST = 1_790_121_600;
const DAYS = 10;
const day = (i: number, fields: Partial<AnalyticsDay>): AnalyticsDay => ({
  day: FIRST + i * 86_400,
  tvlUSD: null,
  volumeUSD: null,
  feesUSD: null,
  svlUSD: null,
  apr: null,
  dailyRewardsUSD: null,
  status: null,
  estimated: false,
  ...fields,
});
const rewarded = (i: number, tvl: number, svl: number) =>
  i >= 2 && i < DAYS - 1
    ? day(i, { tvlUSD: tvl, volumeUSD: tvl / 2, feesUSD: tvl / 400, svlUSD: svl, apr: 50, dailyRewardsUSD: 110, status: "LIVE", estimated: true, dailyRewardsTEL: 71_364 })
    : day(i, { tvlUSD: tvl, volumeUSD: tvl / 3, feesUSD: tvl / 600 });
const pool = (id: string, chain: "polygon" | "base" | "ethereum", name: string, tvl: number, svlShare: number) => ({
  id,
  chain,
  name,
  days: Array.from({ length: DAYS }, (_, i) => (chain === "ethereum" ? day(i, { tvlUSD: tvl, volumeUSD: 10, feesUSD: 0.03 }) : rewarded(i, tvl, tvl * svlShare))),
});

export const LIVE_SHAPE: AnalyticsResponse = {
  historyFrom: FIRST,
  rewardsFrom: FIRST + 2 * 86_400,
  telUSD: {},
  pools: [
    pool("0xa22a", "polygon", "WETH/TEL", 112_460, 0.88),
    pool("0x1266", "polygon", "eUSD/TEL", 80_369, 1.06),
    pool("0x3b1c", "polygon", "eUSD/eMXN", 64_000, 0.98),
    pool("0x4d2e", "base", "ETH/TEL", 30_000, 0.95),
    pool("0x5e3f", "base", "eUSD/TEL", 31_000, 0.99),
    pool("0x6f40", "ethereum", "ETH/TEL", 5_000, 0),
    pool("0x7051", "ethereum", "eUSD/TEL", 4_000, 0),
  ],
  campaigns: [
    { id: "0xc1", chain: "polygon", poolId: "0xa22a", poolName: "WETH/TEL", start: 1_790_794_800_000, end: 1_791_399_600_000, dailyBudgetUSD: 168, dailyBudgetTEL: 71_364, aprMin: 45, aprMax: 70, peakSvlUSD: 103_000, estimated: true },
    { id: "0xc2", chain: "base", poolId: "0x4d2e", poolName: "ETH/TEL", start: 1_790_794_800_000, end: 1_791_399_600_000, dailyBudgetUSD: 170, dailyBudgetTEL: 71_429, aprMin: 180, aprMax: 200, peakSvlUSD: 30_000, estimated: true },
  ],
};

// Charts measure their container; give them a real size so recharts lays out every series.
class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 600, height: 200 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = SizedResizeObserver as unknown as typeof ResizeObserver;
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 200 });

const respond = (body: unknown) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

describe("AnalyticsPage with the live payload's shape", () => {
  beforeEach(() => window.history.replaceState(null, "", "/analytics"));

  it.each(["", "#pools", "#campaigns", "#reports"])("renders %p without hanging", async hash => {
    window.history.replaceState(null, "", `/analytics${hash}`);
    global.fetch = respond(LIVE_SHAPE) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(await screen.findByText(/History starts/, undefined, { timeout: 4000 })).toBeInTheDocument();
  }, 8000);
});

describe("AnalyticsPage without a TEL price", () => {
  beforeEach(() => window.history.replaceState(null, "", "/analytics"));

  it("says the TEL price history hasn't started, and still reports TEL distributed from the rewards rows", async () => {
    global.fetch = respond(LIVE_SHAPE) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    expect(screen.getByText("The TEL price history starts once daily pool prices are recorded.")).toBeInTheDocument();
    // Five reward pools record 71,364 TEL each on their live days; the last day has no rewards row.
    expect(screen.getByRole("img", { name: "TEL distributed per day, Oct 1, 2026: TEL 357K, USD value $550.00." })).toBeInTheDocument();
  });

  it("caps a subscribed share above 100% and says why", async () => {
    const user = userEvent.setup();
    global.fetch = respond(LIVE_SHAPE) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    expect(screen.getByText(/SVL reads above TVL, because the two are measured at different moments/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Pool" }), "polygon:0x1266");
    await user.click(screen.getByRole("tab", { name: "Pools" }));
    expect(within(screen.getByRole("region", { name: "Pools" })).getByText("100%")).toBeInTheDocument();
  });
});

describe("AnalyticsPage chart axes", () => {
  beforeEach(() => window.history.replaceState(null, "", "/analytics"));

  it("labels every axis compactly, so the widest tick fits the axis column", async () => {
    global.fetch = respond(LIVE_SHAPE) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    // Each chart's drawing sits in a role="img" wrapper whose only text is its axis ticks.
    const charts = screen.getAllByRole("img");
    const readTicks = () => charts.flatMap(chart => within(chart).queryAllByText(/./).map(tick => tick.textContent ?? ""));
    await waitFor(() => expect(readTicks().some(tick => tick.startsWith("$"))).toBe(true));
    const ticks = readTicks();
    for (const tick of ticks) {
      expect(tick).not.toMatch(/\.\d{2}$/);
      expect(tick.length).toBeLessThanOrEqual(7);
    }
    expect(ticks).toEqual(expect.arrayContaining([expect.stringMatching(/^\$\d+(\.\d)?[KM]$/)]));
  });
});
