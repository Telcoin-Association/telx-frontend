import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PositionHistory, { formatChange, formatPrice, formatSignedUSD, isFullRange, type PositionHistoryData, type PositionPerformanceData } from "./PositionHistory";

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
    expect(await screen.findByText(/^Value on Sep 30, 2026: \$1,080\.00/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/positions/history?chain=polygon&tokenId=42");
    expect(screen.getByText("+$40.00 against holding the tokens")).toBeInTheDocument();
    expect(screen.getByText("$32.50")).toBeInTheDocument();
    // A response without performance figures keeps the panel it always had.
    expect(screen.queryByRole("region", { name: "Profit and loss" })).not.toBeInTheDocument();
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
