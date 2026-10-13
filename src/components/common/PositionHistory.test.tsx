import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PositionHistory, {
  describeTimeInRange,
  formatChange,
  formatPrice,
  formatSignedUSD,
  isFullRange,
  timeInRangeOf,
  timeInRangeShare,
  type PositionHistoryData,
  type PositionPerformanceData,
} from "./PositionHistory";

/** The tooltip label formatters the charts were last rendered with, one per chart. */
const mockTooltipLabels: ((value: unknown) => string)[] = [];

jest.mock("recharts", () => {
  const passthrough = (name: string) =>
    function MockChartPart({ children }: { children?: React.ReactNode }) {
      return <div data-testid={name}>{children}</div>;
    };
  return {
    ResponsiveContainer: passthrough("container"),
    LineChart: passthrough("line-chart"),
    Line: passthrough("line"),
    XAxis: function MockXAxis({ dataKey, type, scale, domain, ticks, tickFormatter }: { dataKey: string; type: string; scale: string; domain: unknown; ticks?: number[]; tickFormatter: (value: number) => string }) {
      return (
        <div
          data-testid="x-axis"
          data-key={dataKey}
          data-type={type}
          data-scale={scale}
          data-domain={JSON.stringify(domain)}
          data-ticks={JSON.stringify(ticks ?? null)}
          data-labels={JSON.stringify((ticks ?? []).map(tickFormatter))}
        />
      );
    },
    YAxis: function MockYAxis({ domain, ticks }: { domain?: unknown; ticks?: number[] }) {
      return <div data-testid="y-axis" data-domain={JSON.stringify(domain)} data-ticks={JSON.stringify(ticks ?? null)} />;
    },
    CartesianGrid: passthrough("grid"),
    Tooltip: function MockTooltip({ labelFormatter }: { labelFormatter: (value: unknown) => string }) {
      mockTooltipLabels.push(labelFormatter);
      return <div data-testid="tooltip" />;
    },
    ReferenceArea: passthrough("range-band"),
    ReferenceLine: function MockReferenceLine({ x, label }: { x: number; label: { value: string } }) {
      return <div data-testid="hourly-start" data-x={x} data-label={label.value} />;
    },
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

afterEach(() => {
  jest.restoreAllMocks();
  mockTooltipLabels.length = 0;
});

describe("PositionHistory", () => {
  it("loads the position's history and gives every chart figure as text", async () => {
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);

    expect(screen.getByText("Loading position history…")).toBeInTheDocument();
    expect(await screen.findByText(/^Value on Sep 30, 2026: \$1,080\.00/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/positions/history?chain=polygon&tokenId=42");
    expect(screen.getByText("+$40.00 against holding the tokens")).toBeInTheDocument();
    expect(screen.getByText("$32.50")).toBeInTheDocument();
    // A response without performance figures keeps the panel it always had.
    expect(screen.queryByRole("region", { name: "Profit and loss" })).not.toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 days by daily close")).toBeInTheDocument();

    const valueChart = screen.getByRole("img", { name: /^Value on Sep 30, 2026: \$1,080\.00, against \$1,040\.00/ });
    expect(valueChart).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Range 800K to 1.2M TEL per WETH. Now 1M. In range 2 of 3 days by daily close." })).toBeInTheDocument();
    // A response cached before hourly points existed is daily throughout: no hourly mark, dates in the tooltip.
    expect(screen.queryByTestId("hourly-start")).not.toBeInTheDocument();
    expect(mockTooltipLabels[0]((START + DAY) * 1000)).toBe("Sep 29, 2026");
    expect(screen.getByTestId("range-band")).toBeInTheDocument();
    expect(screen.queryByText(/rewards/i)).not.toBeInTheDocument();
    expect(screen.getByText("History since Sep 28, 2026.")).toBeInTheDocument();
    expect(screen.getByText(data.notes[0])).toBeInTheDocument();
  });

  it("pads the value chart's axis around both lines instead of starting at $0", async () => {
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);
    await screen.findByText(/^Value on Sep 30, 2026/);
    // Position values run $1,000 to $1,080 and held values $1,000 to $1,100, so the span is $100 and the padding $5.
    const valueAxis = screen.getAllByTestId("y-axis")[0];
    expect(JSON.parse(valueAxis.dataset.domain!)).toEqual([995, 1_105]);
    expect(JSON.parse(valueAxis.dataset.ticks!)).toEqual([1_000, 1_025, 1_050, 1_075, 1_100]);
  });

  it("labels hourly points by the hour and counts time in range in hours, from a response cached before hourlyFrom existed", async () => {
    const HOUR = 3_600;
    const hours = data.days.map((day, i) => ({ ...day, day: START + 14 * HOUR + i * HOUR }));
    global.fetch = respond(200, { ...data, granularity: "hour", days: hours, historyFrom: hours[0].day, timeInRange: { days: 3, inRangeDays: 2 } }) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);

    expect(await screen.findByText(/^Value on Sep 28, 2026, 16:00 UTC: \$1,080\.00/)).toBeInTheDocument();
    expect(screen.getByText("2 of 3 hours by hourly close")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /In range 2 of 3 hours by hourly close\.$/ })).toBeInTheDocument();
    expect(screen.getByText("History since Sep 28, 2026, 14:00 UTC.")).toBeInTheDocument();
    expect(screen.getByText(/^One point per hour, at each hour's closing price\. Hourly prices are kept for the last 30 days/)).toBeInTheDocument();
    // Every point is an hour, so there is no boundary to mark.
    expect(screen.queryByTestId("hourly-start")).not.toBeInTheDocument();
    // A few hours tick by the hour.
    expect(JSON.parse(screen.getAllByTestId("x-axis")[0].dataset.labels!)).toEqual(["14:00", "15:00", "16:00"]);
  });

  describe("daily then hourly points", () => {
    const HOUR = 3_600;
    const hourlyFrom = START + 3 * DAY; // 2026-10-01 00:00 UTC
    const mixedDays = [
      ...data.days,
      ...Array.from({ length: 48 }, (_, i) => ({ day: hourlyFrom + i * HOUR, price: 1_000_000, inRange: i % 2 === 0, valueUSD: 1_100, heldUSD: 1_050 })),
    ];
    const mixed: PositionHistoryData = {
      ...data,
      granularity: "mixed",
      hourlyFrom,
      days: mixedDays,
      timeInRange: { days: 3, inRangeDays: 2, hours: 48, inRangeHours: 24 },
    };

    it("puts the points on a time axis, marks where hourly points start, and labels each point by its own resolution", async () => {
      global.fetch = respond(200, mixed) as unknown as typeof fetch;
      render(<PositionHistory chain="polygon" tokenId="42" />);

      expect(await screen.findByText(/^Value on Oct 2, 2026, 23:00 UTC: \$1,100\.00/)).toBeInTheDocument();
      const axes = screen.getAllByTestId("x-axis");
      expect(axes).toHaveLength(2);
      for (const axis of axes) {
        expect(axis.dataset).toMatchObject({ key: "t", type: "number", scale: "time", domain: JSON.stringify(["dataMin", "dataMax"]) });
      }
      // Five days of history tick daily, by date, at UTC midnight.
      expect(JSON.parse(axes[0].dataset.labels!)).toEqual(["Sep 28", "Sep 29", "Sep 30", "Oct 1", "Oct 2"]);

      const marks = screen.getAllByTestId("hourly-start");
      expect(marks).toHaveLength(2);
      for (const mark of marks) expect(mark.dataset).toMatchObject({ x: String(hourlyFrom * 1000), label: "Hourly" });
      expect(screen.getByRole("img", { name: /^Value on .* Hourly points from Oct 1, 2026, 00:00 UTC\.$/ })).toBeInTheDocument();

      // Both charts label a daily point by its date and an hourly point by its hour.
      expect(mockTooltipLabels.length).toBeGreaterThanOrEqual(2);
      for (const label of mockTooltipLabels.slice(-2)) {
        expect(label((START + DAY) * 1000)).toBe("Sep 29, 2026");
        expect(label((hourlyFrom + 14 * HOUR) * 1000)).toBe("Oct 1, 2026, 14:00 UTC");
      }
      expect(screen.getByText(/^One point per day at each day's closing price, then one per hour from Oct 1, 2026, 00:00 UTC/)).toBeInTheDocument();
    });

    it("counts time in range by daily close, then by hourly close", async () => {
      global.fetch = respond(200, mixed) as unknown as typeof fetch;
      render(<PositionHistory chain="polygon" tokenId="42" />);

      expect(await screen.findByText("2 of 3 days by daily close, then 24 of 48 hours by hourly close")).toBeInTheDocument();
      // A day weighs 24 hours: (2 * 24 + 24) / (3 * 24 + 48) = 60%.
      expect(screen.getByText("60%")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: /In range 2 of 3 days by daily close, then 24 of 48 hours by hourly close\. Hourly points/ })).toBeInTheDocument();
    });
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

describe("PositionHistory performance", () => {
  const performance: PositionPerformanceData = {
    openedAt: START,
    priceChange: { token0: { open: 2_686, now: 2_749, change: 0.02345 }, token1: { open: 0.00151, now: 0.00215, change: 0.4258 } },
    depositedUSD: 1_000,
    withdrawnUSD: 0,
    valueUSD: 1_080,
    heldUSD: 1_040,
    impermanentLoss: 0.0385,
    rewards: { amount: 77_500, symbol: "TEL", usd: 167 },
    feesAndRewardsUSD: 199.5,
    pnlUSD: 279.5,
    pnl: 0.2795,
  };

  it("leads with profit and loss, then the breakdown, then the caveats", async () => {
    global.fetch = respond(200, { ...data, performance }) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);

    const headline = await screen.findByRole("region", { name: "Profit and loss" });
    expect(headline).toHaveTextContent("+$279.50");
    expect(headline).toHaveTextContent("+27.95%");
    expect(headline).toHaveTextContent("$1,000.00 put in, $1,080.00 in the position now, plus $199.50 in fees and rewards.");
    expect(screen.getByText("+2.35%")).toHaveClass("text-green-400");
    expect(screen.getByText("+42.58%")).toBeInTheDocument();
    expect(screen.getByText("+3.85%")).toBeInTheDocument();
    expect(screen.getByText("$199.50")).toBeInTheDocument();
    expect(screen.getByText("$167.00 TELx rewards: 77,500 TEL")).toBeInTheDocument();
    expect(screen.getByText(/These figures are estimates\. .*Fees already collected aren't counted\. TELx rewards are Merkl's figures/)).toBeInTheDocument();
  });

  it("names withdrawals, shows a loss in red, and reads Unavailable for what it couldn't work out", async () => {
    const losing = { ...performance, withdrawnUSD: 400, pnlUSD: -25, pnl: -0.025, impermanentLoss: null, rewards: null, feesAndRewardsUSD: 32.5 };
    global.fetch = respond(200, { ...data, performance: losing }) as unknown as typeof fetch;
    render(<PositionHistory chain="polygon" tokenId="42" />);

    const headline = await screen.findByRole("region", { name: "Profit and loss" });
    expect(headline).toHaveTextContent("$400.00 taken out");
    expect(screen.getByText("-$25.00")).toHaveClass("text-red-300");
    expect(screen.getByText("-2.5%")).toHaveClass("text-red-300");
    expect(screen.queryByText(/TELx rewards:/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(1);
  });
});

describe("time in range", () => {
  it("reads responses cached before hourly counts had their own fields", () => {
    expect(timeInRangeOf({ timeInRange: { days: 3, inRangeDays: 2 } })).toEqual({ days: 3, inRangeDays: 2, hours: 0, inRangeHours: 0 });
    expect(timeInRangeOf({ granularity: "hour", timeInRange: { days: 5, inRangeDays: 4 } })).toEqual({ days: 0, inRangeDays: 0, hours: 5, inRangeHours: 4 });
    expect(timeInRangeOf({ granularity: "mixed", timeInRange: { days: 1, inRangeDays: 1, hours: 2, inRangeHours: 0 } })).toEqual({ days: 1, inRangeDays: 1, hours: 2, inRangeHours: 0 });
  });

  it("weighs a day as 24 hours and words each part by its own close", () => {
    expect(timeInRangeShare({ days: 1, inRangeDays: 1, hours: 24, inRangeHours: 0 })).toBe(50);
    expect(timeInRangeShare({ days: 0, inRangeDays: 0, hours: 0, inRangeHours: 0 })).toBeNull();
    expect(describeTimeInRange({ days: 1, inRangeDays: 1, hours: 1, inRangeHours: 0 })).toBe("1 of 1 day by daily close, then 0 of 1 hour by hourly close");
    expect(describeTimeInRange({ days: 0, inRangeDays: 0, hours: 720, inRangeHours: 700 })).toBe("700 of 720 hours by hourly close");
  });
});

describe("formatChange and formatSignedUSD", () => {
  it("signs changes and amounts, and reads Unavailable without a value", () => {
    expect(formatChange(0.0234)).toBe("+2.34%");
    expect(formatChange(-0.005)).toBe("-0.5%");
    expect(formatChange(0)).toBe("0.0%");
    expect(formatChange(null)).toBe("Unavailable");
    expect(formatSignedUSD(38.333)).toBe("+$38.33");
    expect(formatSignedUSD(-4.1)).toBe("-$4.10");
    expect(formatSignedUSD(undefined)).toBe("Unavailable");
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
