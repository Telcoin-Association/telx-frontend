import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PositionHistory, { formatPrice, isFullRange, type PositionHistoryData } from "./PositionHistory";

jest.mock("recharts", () => {
  const passthrough = (name: string) =>
    function MockChartPart({ children }: { children?: React.ReactNode }) {
      return <div data-testid={name}>{children}</div>;
    };
  return {
    ResponsiveContainer: passthrough("container"),
    LineChart: passthrough("line-chart"),
    Line: passthrough("line"),
    XAxis: passthrough("x-axis"),
    YAxis: passthrough("y-axis"),
    CartesianGrid: passthrough("grid"),
    Tooltip: passthrough("tooltip"),
    ReferenceArea: passthrough("range-band"),
  };
});

const DAY = 86_400;
const START = 1_790_553_600; // 2026-09-28 00:00 UTC

const data: PositionHistoryData = {
  currency0: { symbol: "WETH" },
  currency1: { symbol: "TEL" },
  tickLower: 136_080,
  tickUpper: 140_160,
  priceLower: 800_000,
  priceUpper: 1_200_000,
  currentPrice: 1_000_000,
  inRange: true,
  days: [
    { day: START, price: 990_000, inRange: true, valueUSD: 1_000, heldUSD: 1_000 },
    { day: START + DAY, price: 1_300_000, inRange: false, valueUSD: 1_050, heldUSD: 1_100 },
    { day: START + 2 * DAY, price: 1_000_000, inRange: true, valueUSD: 1_080, heldUSD: 1_040 },
  ],
  timeInRange: { days: 3, inRangeDays: 2 },
  fees: { amount0: 0.01, amount1: 2_000, usd: 32.5 },
  historyFrom: START,
  notes: ["Earlier days are valued at today's token prices."],
};

const respond = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => jest.restoreAllMocks());

describe("PositionHistory", () => {
  it("loads the position's history and gives every chart figure as text", async () => {
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);

    expect(screen.getByText("Loading position history…")).toBeInTheDocument();
    expect(await screen.findByText("$1,080.00")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/positions/history?chain=polygon&tokenId=42");
    expect(screen.getByText("+$40.00 against holding")).toBeInTheDocument();
    expect(screen.getByText("$32.50")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 days, by daily close")).toBeInTheDocument();

    const valueChart = screen.getByRole("img", { name: /^Value on Sep 30, 2026: \$1,080\.00, against \$1,040\.00/ });
    expect(valueChart).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Range 800K to 1.2M TEL per WETH. Now 1M. In range 2 of 3 days." })).toBeInTheDocument();
    expect(screen.getByTestId("range-band")).toBeInTheDocument();
    expect(screen.queryByText(/rewards/i)).not.toBeInTheDocument();
    expect(screen.getByText("History since Sep 28, 2026.")).toBeInTheDocument();
    expect(screen.getByText(data.notes[0])).toBeInTheDocument();
  });

  it("says when the position isn't in a TELx pool", async () => {
    global.fetch = respond(404, { error: "Position not found in a TELx pool" }) as unknown as typeof fetch;
    render(<PositionHistory chain="base" tokenId="7" />);
    expect(await screen.findByText("This position isn't in a TELx pool.")).toBeInTheDocument();
  });

  it("says when the history could not be loaded", async () => {
    global.fetch = respond(502, { error: "Position history lookup failed" }) as unknown as typeof fetch;
    render(<PositionHistory chain="base" tokenId="7" />);
    expect(await screen.findByText("The position history could not be loaded.")).toBeInTheDocument();
  });

  it("reads Unavailable for fees and time in range it doesn't have", async () => {
    global.fetch = respond(200, { ...data, fees: null, timeInRange: { days: 0, inRangeDays: 0 }, days: [] }) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);
    expect(await screen.findByText("No day could be valued yet.")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
  });
});

describe("PositionHistory full range", () => {
  it("says Full range instead of the tick limits, and draws no band", async () => {
    const full = { ...data, tickLower: -887_220, tickUpper: 887_220, priceLower: 2.9543e-39, priceUpper: 3.3849e38 };
    global.fetch = respond(200, full) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);

    expect(await screen.findByRole("img", { name: "Full range. Now 1M TEL per WETH." })).toBeInTheDocument();
    expect(screen.getByText("Always (full range)")).toBeInTheDocument();
    expect(screen.queryByTestId("range-band")).not.toBeInTheDocument();
    expect(screen.queryByText(/e-39|338,490/)).not.toBeInTheDocument();
  });
});

describe("formatPrice and isFullRange", () => {
  it("reads prices compactly, with three significant digits", () => {
    expect(formatPrice(1_163_700)).toBe("1.16M");
    expect(formatPrice(4_980)).toBe("4,980");
    expect(formatPrice(0.000859321)).toBe("0.000859");
    expect(formatPrice(null)).toBe("Unavailable");
  });

  it("treats ticks at the pool's limits as full range", () => {
    expect(isFullRange(-887_220, 887_220)).toBe(true);
    expect(isFullRange(-887_272, 887_272)).toBe(true);
    expect(isFullRange(136_080, 140_160)).toBe(false);
    expect(isFullRange(-887_220, 140_160)).toBe(false);
  });
});
