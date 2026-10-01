import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalyticsPage, { SeriesTooltipContent } from "./AnalyticsPage";
import type { AnalyticsResponse } from "../../lib/analytics";

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
  };
});

const mockDownload = jest.fn();
jest.mock("../../lib/analytics", () => ({ ...jest.requireActual("../../lib/analytics"), downloadCsv: (...args: unknown[]) => mockDownload(...args) }));

const D1 = 1_790_726_400;
const day = (fields: Record<string, unknown>) => ({ day: D1, tvlUSD: null, volumeUSD: null, feesUSD: null, svlUSD: null, apr: null, dailyRewardsUSD: null, status: null, estimated: false, ...fields });

const data: AnalyticsResponse = {
  historyFrom: D1,
  rewardsFrom: D1,
  telUSD: { [String(D1)]: 0.002 },
  pools: [
    { id: "0xa", chain: "polygon", name: "WETH/TEL", days: [day({ tvlUSD: 200, svlUSD: 50, dailyRewardsUSD: 10, apr: 73, status: "LIVE" })] },
    { id: "0xb", chain: "base", name: "ETH/TEL", days: [day({ tvlUSD: 100, status: "SOON" })] },
  ],
  campaigns: [
    { id: "0xc1c1c1c1c1c1", chain: "polygon", poolId: "0xa", poolName: "WETH/TEL", start: Date.UTC(2026, 8, 25), end: Date.UTC(2026, 9, 2), dailyBudgetUSD: 170, aprMin: 60, aprMax: 120, peakSvlUSD: 97_000, estimated: false },
  ],
};

const respond = (status: number, body: unknown) => jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => mockDownload.mockReset());

describe("AnalyticsPage", () => {
  it("shows the history start, the pools and the campaigns once loaded", async () => {
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(screen.getByText("Loading analytics…")).toBeInTheDocument();

    expect(await screen.findByText(/History starts Sep 30, 2026/)).toBeInTheDocument();
    const poolsTable = within(screen.getByRole("region", { name: "Pools" }));
    expect(poolsTable.getByText("WETH/TEL")).toBeInTheDocument();
    expect(poolsTable.getByText("73%")).toBeInTheDocument();
    expect(poolsTable.getByText("25%")).toBeInTheDocument();
    expect(poolsTable.getByText("$1,400.00")).toBeInTheDocument();

    const campaigns = within(screen.getByRole("region", { name: "Campaigns" }));
    expect(campaigns.getByText("WETH/TEL on Polygon")).toBeInTheDocument();
    expect(campaigns.getByText("60% to 120%")).toBeInTheDocument();
  });

  it("filters by chain, and charts one pool once it's chosen", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    await user.click(screen.getByRole("button", { name: "Base" }));
    const poolsTable = within(screen.getByRole("region", { name: "Pools" }));
    expect(poolsTable.queryByText("WETH/TEL")).not.toBeInTheDocument();
    expect(poolsTable.getByText("ETH/TEL")).toBeInTheDocument();
    expect(screen.getByText("No campaigns recorded for this selection yet.")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Pool" }), "base:0xb");
    expect(screen.getByText("ETH/TEL APR")).toBeInTheDocument();
  });

  it("exports a series as CSV", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    const tvl = screen.getByRole("figure", { name: "TVL and Subscribed Value Locked" });
    await user.click(within(tvl).getByRole("button", { name: "CSV" }));
    expect(mockDownload).toHaveBeenCalledWith("telx-tvl-svl.csv", "date,TVL,SVL\r\n2026-09-30,300,50");
  });

  it("gives every chart a text alternative with its latest figures", async () => {
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);
    expect(screen.getByRole("img", { name: "TEL distributed per day, Sep 30, 2026: TEL 5K, USD value $10.00." })).toBeInTheDocument();
  });

  it("notes estimated rewards figures, and marks campaigns that include them", async () => {
    const estimated: AnalyticsResponse = {
      ...data,
      pools: [{ ...data.pools[0], days: [day({ tvlUSD: 200, svlUSD: 50, dailyRewardsUSD: 10, apr: 73, status: "LIVE", estimated: true })] }],
      campaigns: [{ ...data.campaigns[0], estimated: true }],
    };
    global.fetch = respond(200, estimated) as unknown as typeof fetch;
    render(<AnalyticsPage />);

    expect(await screen.findByText(/are our estimates, from each campaign's funding and the positions subscribed on chain/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Campaigns" })).getByText("Estimated")).toBeInTheDocument();
  });

  it("has no estimate note when every rewards figure is Merkl's own", async () => {
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);
    expect(screen.queryByText(/are our estimates/)).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated")).not.toBeInTheDocument();
  });

  it("says a pool's rewards history isn't recorded yet when it has day rows but no Merkl rows, rather than Unavailable", async () => {
    const user = userEvent.setup();
    const days = Array.from({ length: 9 }, (_, i) => day({ day: D1 - (7 - i) * 86_400, tvlUSD: 150_000, volumeUSD: 500 }));
    const unrecorded: AnalyticsResponse = { ...data, rewardsFrom: null, campaigns: [], pools: [{ id: "0xa", chain: "polygon", name: "WETH/TEL", days }] };
    global.fetch = respond(200, unrecorded) as unknown as typeof fetch;
    render(<AnalyticsPage />);

    expect(await screen.findByText(/APR, SVL and rewards history starts once the first daily Merkl rows are recorded\./)).toBeInTheDocument();
    const poolsTable = within(screen.getByRole("region", { name: "Pools" }));
    expect(poolsTable.getByText("Not recorded yet")).toBeInTheDocument();
    expect(poolsTable.queryByText("Unavailable")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Pool" }), "polygon:0xa");
    expect(screen.getByText("WETH/TEL's APR and rewards history starts once its first daily Merkl row is recorded.")).toBeInTheDocument();
    expect(screen.queryByText("WETH/TEL APR")).not.toBeInTheDocument();
  });

  it("says when a pool's latest rewards row isn't a live campaign", async () => {
    global.fetch = respond(200, { ...data, pools: [{ ...data.pools[0], days: [day({ tvlUSD: 200, status: "PAST" })] }] }) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(await screen.findByText("No live campaign")).toBeInTheDocument();
    expect(screen.getByText(/APR, SVL and rewards history starts Sep 30, 2026\./)).toBeInTheDocument();
  });

  it("says when nothing has been recorded yet", async () => {
    global.fetch = respond(200, { ...data, historyFrom: null, rewardsFrom: null, pools: [], campaigns: [] }) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(await screen.findByText("History starts once the first daily rows are recorded.")).toBeInTheDocument();
  });

  it("says when the analytics can't be loaded", async () => {
    global.fetch = respond(502, { error: "x" }) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(await screen.findByText("Analytics are unavailable right now. Try again later.")).toBeInTheDocument();
  });
});

describe("SeriesTooltipContent", () => {
  const series = [
    { key: "tvlUSD" as const, label: "TVL", color: "#ffffff", format: (value: number | null) => (value === null ? "Unavailable" : `$${value}`) },
    { key: "svlUSD" as const, label: "SVL", color: "#4967ff", format: (value: number | null) => (value === null ? "Unavailable" : `$${value}`) },
  ];

  it("lists each series by label and value, with its colour only on the swatch", () => {
    render(
      <SeriesTooltipContent<{ tvlUSD: number; svlUSD: number }>
        active
        label="2026-09-30"
        series={series}
        payload={[
          { dataKey: "tvlUSD", value: 1200 },
          { dataKey: "svlUSD", value: null },
        ]}
      />,
    );
    expect(screen.getByText("Sep 30, 2026")).toBeInTheDocument();
    expect(screen.getByText("TVL")).toBeInTheDocument();
    expect(screen.getByText("$1200")).toHaveClass("font-semibold");
    // The value takes the card's white text; a white series line colours only its swatch.
    expect(screen.getByText("$1200")).not.toHaveAttribute("style");
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("renders nothing while the chart is not hovered", () => {
    const { container } = render(<SeriesTooltipContent active={false} series={series} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
