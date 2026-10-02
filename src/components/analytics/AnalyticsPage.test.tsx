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
    ComposedChart: passthrough("chart"),
    Bar: passthrough("bar"),
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
    { id: "0xc1c1c1c1c1c1", chain: "polygon", poolId: "0xa", poolName: "WETH/TEL", start: Date.UTC(2026, 8, 25), end: Date.UTC(2026, 9, 2), dailyBudgetUSD: 170, dailyBudgetTEL: 71_364, aprMin: 60, aprMax: 120, peakSvlUSD: 97_000, estimated: false },
  ],
};

const respond = (status: number, body: unknown) => jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  mockDownload.mockReset();
  // The page keeps its tab in the URL hash, which jsdom carries from one test to the next.
  window.history.replaceState(null, "", "/analytics");
});

describe("AnalyticsPage", () => {
  it("shows the history start, the pools and the campaigns once loaded", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(screen.getByText("Loading analytics…")).toBeInTheDocument();

    expect(await screen.findByText(/History starts Sep 30, 2026/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Pools" }));
    const poolsTable = within(screen.getByRole("region", { name: "Pools" }));
    expect(poolsTable.getByText("WETH/TEL")).toBeInTheDocument();
    expect(poolsTable.getByText("73%")).toBeInTheDocument();
    expect(poolsTable.getByText("25%")).toBeInTheDocument();
    expect(poolsTable.getByText("$1,400.00")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Campaigns" }));
    const campaigns = within(screen.getByRole("region", { name: "Campaigns" }));
    expect(campaigns.getByText("WETH/TEL on Polygon")).toBeInTheDocument();
    expect(campaigns.getByText("60% to 120%")).toBeInTheDocument();
    expect(campaigns.getByText("71.4K TEL")).toBeInTheDocument();
    expect(campaigns.getByText("$170.00")).toBeInTheDocument();
  });

  it("filters by chain, and charts one pool once it's chosen", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, data) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    await user.click(screen.getByRole("button", { name: "Base" }));
    await user.click(screen.getByRole("tab", { name: "Pools" }));
    const poolsTable = within(screen.getByRole("region", { name: "Pools" }));
    expect(poolsTable.queryByText("WETH/TEL")).not.toBeInTheDocument();
    expect(poolsTable.getByText("ETH/TEL")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Campaigns" }));
    expect(screen.getByText("No campaigns recorded for this selection yet.")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Pool" }), "base:0xb");
    await user.click(screen.getByRole("tab", { name: "Pools" }));
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
    await userEvent.setup().click(screen.getByRole("tab", { name: "Campaigns" }));
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
    await user.click(screen.getByRole("tab", { name: "Pools" }));
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
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Pools" }));
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

describe("AnalyticsPage tabs and reports", () => {
  const D0 = D1 - 86_400;
  const twoDays: AnalyticsResponse = {
    ...data,
    historyFrom: D0,
    telUSD: { [String(D0)]: 0.002, [String(D1)]: 0.0025 },
    pools: [
      {
        id: "0xa",
        chain: "polygon",
        name: "WETH/TEL",
        days: [
          day({ day: D0, tvlUSD: 1000, svlUSD: 400, volumeUSD: 100, feesUSD: 1, dailyRewardsUSD: 4, apr: 365, status: "LIVE" }),
          day({ day: D1, tvlUSD: 2000, svlUSD: 1000, volumeUSD: 300, feesUSD: 2, dailyRewardsUSD: 10, apr: 365, status: "LIVE" }),
        ],
      },
      { id: "0xb", chain: "base", name: "ETH/TEL", days: [day({ day: D1, tvlUSD: 500, volumeUSD: 50, feesUSD: 0.5 })] },
    ],
  };

  it("opens on the Overview tab, with the APR breakdown, subscribed share, cumulative totals and TEL price", async () => {
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Pools" })).not.toBeInTheDocument();
    // Sep 30: incentives 10 / 1000 x 365, fees 2.5 / 2500 x 365.
    expect(screen.getByRole("img", { name: "APR: incentives, fees and total, Sep 30, 2026: Total APR 401.5%, Incentives APR 365%, Fees APR 36.5%." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Subscribed share of TVL, Sep 30, 2026: Subscribed share 40%." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cumulative volume and fees, Sep 30, 2026: Volume $450.00, Fees $3.50." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "TEL price, Sep 30, 2026: TEL $0.0025." })).toBeInTheDocument();
  });

  it("draws daily amounts as bars and levels as lines, with volume and fees in separate charts", async () => {
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    expect(screen.getByRole("img", { name: "Volume per day, Sep 30, 2026: Volume $350.00." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Fees per day, Sep 30, 2026: Fees $2.50." })).toBeInTheDocument();
    // Volume, fees and TEL distributed are bars; the rest of the Overview are lines.
    expect(screen.getAllByTestId("bar")).toHaveLength(3);
    // TEL distributed is in TEL and its USD value in dollars, so the dollar series has its own axis.
    expect(screen.getByText("USD value (right axis)")).toBeInTheDocument();
    expect(screen.getByText("Fees (right axis)")).toBeInTheDocument();
  });

  it("groups the chain and range filters, and keeps the notes behind one line", async () => {
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    expect(within(screen.getByRole("group", { name: "Filter by chain" })).getByRole("button", { name: "All chains" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Date range" })).getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("About these figures")).toBeInTheDocument();
    // Four tabs share the row evenly on a phone, so none scrolls out of view.
    expect(screen.getByRole("tablist", { name: "Analytics sections" })).toHaveClass("grid", "grid-cols-4");
    expect(screen.getByRole("tablist", { name: "Analytics sections" })).not.toHaveClass("overflow-x-auto");
  });

  it("moves between tabs with the arrow keys and keeps the tab in the URL hash", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);

    screen.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Pools" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Pools" })).toHaveFocus();
    expect(window.location.hash).toBe("#pools");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Reports" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the tab the URL hash names", async () => {
    window.history.replaceState(null, "", "/analytics#reports");
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    expect(await screen.findByRole("region", { name: "Period summaries" })).toBeInTheDocument();
  });

  it("compares the pools on one chart per figure when several are chosen", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);
    await user.click(screen.getByRole("tab", { name: "Pools" }));

    expect(screen.getByRole("img", { name: "Volume per day by pool, Sep 30, 2026: WETH/TEL on Polygon $300.00, ETH/TEL on Base $50.00." })).toBeInTheDocument();
    const svl = screen.getByRole("figure", { name: "Subscribed Value Locked by pool" });
    await user.click(within(svl).getByRole("button", { name: "CSV" }));
    expect(mockDownload).toHaveBeenCalledWith("telx-pools-svl.csv", "date,WETH/TEL on Polygon,ETH/TEL on Base\r\n2026-09-29,400,\r\n2026-09-30,1000,");

    await user.selectOptions(screen.getByRole("combobox", { name: "Pool" }), "polygon:0xa");
    expect(screen.queryByRole("figure", { name: "Subscribed Value Locked by pool" })).not.toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "WETH/TEL APR: incentives, fees and total" })).toBeInTheDocument();
  });

  it("summarises a period per pool and together, against the previous period", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);
    await user.click(screen.getByRole("tab", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const reports = within(screen.getByRole("region", { name: "Period summaries" }));
    expect(reports.getByRole("combobox", { name: "Period" })).toHaveDisplayValue("Sep 30, 2026");
    const rows = reports.getAllByRole("row");
    const text = (name: string) => rows.find(row => row.textContent?.startsWith(name))?.textContent ?? "";
    expect(text("WETH/TEL on Polygon")).toContain("$2,000.00");
    expect(text("Selected pools")).toContain("$2,500.00");
    expect(text("Selected pools")).toContain("40%");
    expect(text("Previous: Sep 29, 2026")).toContain("$1,000.00");
    // TVL +150%, subscribed share 40% against 40%, volume 350 against 100.
    expect(text("Change")).toContain("+150%");
    expect(text("Change")).toContain("0 pts");
    expect(text("Change")).toContain("+250%");

    await user.selectOptions(reports.getByRole("combobox", { name: "Period" }), String(D0));
    expect(reports.getByText(/Previous period/)).toBeInTheDocument();
  });

  it("says how many days Avg SVL covers when a campaign starts mid-period, and hides a tiny pool's fees APR", async () => {
    const user = userEvent.setup();
    const midWeek: AnalyticsResponse = {
      ...twoDays,
      pools: [
        { id: "0xa", chain: "base", name: "eUSD/TEL", days: [day({ day: D0, tvlUSD: 100, feesUSD: 0.01 }), day({ day: D1, tvlUSD: 30_000, svlUSD: 29_000, feesUSD: 30, dailyRewardsUSD: 160, status: "LIVE" })] },
        { id: "0xb", chain: "ethereum", name: "eUSD/TEL", days: [day({ day: D1, tvlUSD: 11.9, feesUSD: 0.0158 })] },
      ],
    };
    global.fetch = respond(200, midWeek) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);
    await user.click(screen.getByRole("tab", { name: "Reports" }));

    const reports = within(screen.getByRole("region", { name: "Period summaries" }));
    const rows = reports.getAllByRole("row");
    const row = (name: string) => rows.find(candidate => candidate.textContent?.startsWith(name)) as HTMLElement;
    expect(within(row("eUSD/TEL on Base")).getByText("over 1 day with rewards")).toBeInTheDocument();
    // 29,000 / 30,000 on the one day with both figures, not 29,000 over the two-day TVL average.
    expect(row("eUSD/TEL on Base")).toHaveTextContent("96.7%");
    expect(within(row("eUSD/TEL on Ethereum")).getByText("n/a")).toHaveAttribute("title", expect.stringContaining("Fees APR isn't shown for an average TVL under $1,000.00"));
  });

  it("exports every period of the chosen granularity, for the chosen pools together and each pool", async () => {
    const user = userEvent.setup();
    global.fetch = respond(200, twoDays) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await screen.findByText(/History starts/);
    await user.click(screen.getByRole("tab", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(within(screen.getByRole("region", { name: "Period summaries" })).getByRole("button", { name: "CSV" }));

    const [filename, csv] = mockDownload.mock.calls[0] as [string, string];
    expect(filename).toBe("telx-day-summary.csv");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "period,start,to date,days recorded,days with rewards,days from the daily report,fees apr hidden,scope,Avg TVL,Avg SVL,Subscribed share,Incentives APR,Fees APR,Total APR,Volume,Fees,TEL distributed",
    );
    expect(lines).toHaveLength(1 + 2 + 2 + 1);
    expect(lines[1].startsWith("\"Sep 30, 2026\",2026-09-30,no,1,1,0,no,Selected pools,2500,1000,0.4,")).toBe(true);
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

describe("SeriesTooltipContent for report days", () => {
  it("says a row's figures come from the TELx daily report", () => {
    const series = [{ key: "tvlUSD" as const, label: "TVL", color: "#ffffff", format: (value: number | null) => (value === null ? "Unavailable" : `$${value}`) }];
    render(<SeriesTooltipContent<{ tvlUSD: number }> active label="2025-09-01" series={series} payload={[{ dataKey: "tvlUSD", value: 5, payload: { fromReport: true } }]} />);
    expect(screen.getByText("From the TELx daily report")).toBeInTheDocument();
  });
});

describe("AnalyticsPage with the TELx daily report history", () => {
  const R1 = Date.UTC(2025, 8, 1) / 1000;
  const report = {
    source: "TELx daily report",
    from: R1,
    to: R1,
    poolFields: ["day", "tvlUSD", "stakedShare", "stakedUSD", "incentivesApr", "volumeUSD", "feesUSD", "feesApr", "totalApr"],
    programFields: ["day", "tvlUSD", "stakedShare", "stakedUSD", "incentivesApr", "volumeUSD", "feesUSD", "feesApr", "totalApr", "telUSD"],
    pools: [{ key: "balancer-tel-bal", name: "TEL/BAL", label: "TEL 80 BAL 20", chain: "polygon", protocol: "balancer", address: "0xa0ef", days: [[R1, 800_000, 0.99, 790_000, 0.2, 9000, 18, 0.008, 0.208]] }],
    program: [[R1, 800_000, 0.99, 790_000, 0.2, 9000, 18, 0.008, 0.208, 0.004]],
  };
  const withSpan = { ...data, archiveSpan: { from: R1, to: R1 } };
  const routes = (archiveStatus = 200) =>
    jest.fn(async (url: string) =>
      url === "/api/analytics/archive"
        ? { ok: archiveStatus === 200, status: archiveStatus, json: async () => report }
        : { ok: true, status: 200, json: async () => withSpan },
    );

  it("doesn't load the report history for the default range, and loads it for All", async () => {
    const user = userEvent.setup();
    const fetchMock = routes();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AnalyticsPage />);

    expect(await screen.findByText(/Choose All for the TELx daily report's history from Sep 1, 2025/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText(/Days from Sep 1, 2025 to Sep 1, 2025 are from the TELx daily report/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/archive");

    const picker = screen.getByRole("combobox", { name: "Pool" });
    expect(within(picker).getByRole("group", { name: "Archived pools, from the TELx daily report" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "TEL/BAL on Polygon (Balancer, archived)" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Pools" }));
    const poolsTable = within(screen.getByRole("region", { name: "Pools" }));
    expect(poolsTable.getByText("Archived, last reported Sep 1, 2025")).toBeInTheDocument();
  });

  it("shows the whole history when an archived pool is chosen", async () => {
    const user = userEvent.setup();
    global.fetch = routes() as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await user.click(await screen.findByRole("button", { name: "All" }));
    await screen.findByText(/are from the TELx daily report/);
    await user.click(screen.getByRole("button", { name: "30 days" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Pool" }), "polygon:0xa0ef");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so and keeps the recorded history when the report history can't be loaded", async () => {
    const user = userEvent.setup();
    global.fetch = routes(502) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await user.click(await screen.findByRole("button", { name: "All" }));
    expect(await screen.findByText(/history couldn't be loaded, so only the recorded history is shown/)).toBeInTheDocument();
  });
});

describe("Reports wording for report days", () => {
  const R1 = Date.UTC(2025, 8, 1) / 1000;
  const report = {
    source: "TELx daily report",
    from: R1,
    to: R1 + 86_400,
    poolFields: ["day", "tvlUSD", "stakedShare", "stakedUSD", "incentivesApr", "volumeUSD", "feesUSD", "feesApr", "totalApr"],
    programFields: ["day", "tvlUSD", "stakedShare", "stakedUSD", "incentivesApr", "volumeUSD", "feesUSD", "feesApr", "totalApr", "telUSD"],
    pools: [
      {
        key: "balancer-tel-bal",
        name: "TEL/BAL",
        label: "TEL 80 BAL 20",
        chain: "polygon",
        protocol: "balancer",
        address: "0xa0ef",
        days: [
          [R1, 800_000, 0.99, 790_000, 0.2, 9000, 18, 0.008, 0.208],
          [R1 + 86_400, 800_000, 0.99, 790_000, 0.2, 9000, 18, 0.008, 0.208],
        ],
      },
    ],
    program: [],
  };

  it("says every day comes from the report when a period is all report days", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async (url: string) =>
      url === "/api/analytics/archive" ? { ok: true, status: 200, json: async () => report } : { ok: true, status: 200, json: async () => ({ ...data, archiveSpan: { from: R1, to: R1 + 86_400 } }) },
    ) as unknown as typeof fetch;
    render(<AnalyticsPage />);
    await user.click(await screen.findByRole("button", { name: "All" }));
    await screen.findByText(/are from the TELx daily report/);
    await user.click(screen.getByRole("tab", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), String(R1));
    expect(screen.getByText(/Every day comes from the TELx daily report/)).toBeInTheDocument();
  });
});
