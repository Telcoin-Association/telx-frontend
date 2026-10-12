import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { HourlyAnalyticsResponse } from "@/lib/analytics";
import HourlyCharts from "./HourlyCharts";

jest.mock("recharts", () => {
  const passthrough = (name: string) =>
    function MockChartPart({ children }: { children?: React.ReactNode }) {
      return <div data-testid={name}>{children}</div>;
    };
  return {
    ResponsiveContainer: passthrough("container"),
    ComposedChart: passthrough("chart"),
    Bar: passthrough("bar"),
    Line: passthrough("line"),
    XAxis: passthrough("x-axis"),
    YAxis: passthrough("y-axis"),
    CartesianGrid: passthrough("grid"),
    Tooltip: passthrough("tooltip"),
  };
});

const H = 1_791_813_600; // 2026-10-12 14:00 UTC
const DATA: HourlyAnalyticsResponse = {
  from: H - 6 * 86_400 - 9 * 3_600,
  to: H + 3_600,
  historyFrom: H,
  retentionDays: 30,
  pools: [{ id: "0xa", chain: "polygon", name: "WETH/TEL", hours: [{ hour: H, tvlUSD: 100, volumeUSD: 10, feesUSD: 0.03 }, { hour: H + 3_600, tvlUSD: 120, volumeUSD: 5, feesUSD: 0.01 }] }],
  telUSD: { [H]: 0.0017, [H + 3_600]: 0.0018 },
};

const respond = (ok: boolean, body: unknown) => jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 502, json: async () => body });

describe("HourlyCharts", () => {
  it("charts the program hour by hour and says how far hourly data reaches", async () => {
    global.fetch = respond(true, DATA) as unknown as typeof fetch;
    render(<HourlyCharts filter={{ chain: "all", pool: null }} />);

    expect(await screen.findByText("TVL by the hour, Oct 12, 2026, 15:00 UTC: TVL $120.00.")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/analytics/hourly");
    expect(screen.getByText("Volume per hour, Oct 12, 2026, 15:00 UTC: Volume $5.00.")).toBeInTheDocument();
    expect(screen.getByText("TEL price by the hour, Oct 12, 2026, 15:00 UTC: TEL $0.0018.")).toBeInTheDocument();
    expect(screen.getByText(/Hourly data is kept for 30 days, and starts Oct 12, 2026, 14:00 UTC\./)).toBeInTheDocument();
  });

  it("says when the hourly figures can't be loaded, or there are none yet", async () => {
    global.fetch = respond(false, {}) as unknown as typeof fetch;
    const { unmount } = render(<HourlyCharts filter={{ chain: "all", pool: null }} />);
    expect(await screen.findByText("Hourly figures are unavailable right now.")).toBeInTheDocument();
    unmount();

    global.fetch = respond(true, { ...DATA, historyFrom: null, pools: [], telUSD: {} }) as unknown as typeof fetch;
    render(<HourlyCharts filter={{ chain: "all", pool: null }} />);
    expect(await screen.findByText("Hourly figures start once the first hour is recorded.")).toBeInTheDocument();
  });
});
