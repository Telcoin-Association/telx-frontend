import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelRewardsRow from "./LabelRewardsRow";

jest.mock("../../redux/slices/marketRateSlice", () => ({
  useGetMarketRateQuery: () => ({ data: { TEL: { USD: 0.002 } }, isLoading: false }),
}));
jest.mock(
  "./ReturnAsset",
  () =>
    function ReturnAsset() {
      return null;
    },
);

const NOW = Date.UTC(2026, 8, 29, 12);
// 00:00 UTC boundaries, formatted as UTC days whatever the time zone the tests run in.
const START = Date.UTC(2026, 8, 25);
const END = Date.UTC(2026, 9, 2);
const WINDOW = "Sep 25 - Oct 2 (UTC)";

function renderRow(fields: Record<string, unknown>) {
  const contractData = {
    protocol: "uniswap",
    poolContractAddress: "0xpool",
    rewards: [{ amount: 500000, ticker: "TEL" }],
    rewardsInterval: null,
    ...fields,
  } as unknown as ProtocolsContractData;
  return render(<LabelRewardsRow contractData={contractData} defaultRewards={{}} />);
}

describe("LabelRewardsRow", () => {
  it("shows the subscribed APR as pending for a live campaign Merkl has not measured", () => {
    renderRow({ rewardsStatus: "LIVE", rewardsPending: true, rewardsApr: null });
    expect(screen.getByText("Subscribed APR")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it("adds the APR, daily rewards and campaign window for a live campaign", () => {
    renderRow({ rewardsStatus: "LIVE", rewardsApr: 134.75, rewardsDailyRewards: 164.48, rewardsCampaignStart: START, rewardsCampaignEnd: END });
    expect(screen.getByText("Rewards / 7 days")).toBeInTheDocument();
    expect(screen.getByText("500,000")).toBeInTheDocument();
    expect(screen.getByText("Subscribed APR")).toBeInTheDocument();
    expect(screen.getByText("134.8%")).toBeInTheDocument();
    expect(screen.getByText("$164.48 per day")).toBeInTheDocument();
    expect(screen.getByText(WINDOW)).toBeInTheDocument();
  });

  it("shows the window of a scheduled campaign as not started, without an APR", () => {
    renderRow({ rewardsStatus: "SOON", rewardsCampaignStart: START, rewardsCampaignEnd: END });
    expect(screen.getByText(`${WINDOW} (not started)`)).toBeInTheDocument();
    expect(screen.queryByText("Subscribed APR")).not.toBeInTheDocument();
  });

  it("shows the window of an ended campaign as ended", () => {
    renderRow({ rewardsStatus: "PAST", rewardsCampaignStart: START, rewardsCampaignEnd: END });
    expect(screen.getByText(`${WINDOW} (ended)`)).toBeInTheDocument();
  });

  it("reads a live campaign as ended once its end passes, without the APR", () => {
    jest.setSystemTime(END + 60_000);
    renderRow({ rewardsStatus: "LIVE", rewardsApr: 134.75, rewardsDailyRewards: 164.48, rewardsCampaignStart: START, rewardsCampaignEnd: END });
    expect(screen.getByText(`${WINDOW} (ended)`)).toBeInTheDocument();
    expect(screen.queryByText("Subscribed APR")).not.toBeInTheDocument();
  });

  it("adds nothing without Merkl data", () => {
    renderRow({});
    expect(screen.queryByText("Subscribed APR")).not.toBeInTheDocument();
    expect(screen.queryByText("Campaign")).not.toBeInTheDocument();
  });

  it("says when a scheduled campaign starts in place of the weekly amount, as the list row does", () => {
    renderRow({ rewardsStatus: "SOON", rewardsCampaignStart: Date.UTC(2026, 9, 5), rewardsCampaignEnd: Date.UTC(2026, 9, 12) });
    expect(screen.getByText(/^Starting /)).toBeInTheDocument();
    expect(screen.queryByText("500,000")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("falls back to Starting soon for a scheduled campaign without a start date", () => {
    renderRow({ rewardsStatus: "SOON" });
    expect(screen.getByText("Starting soon")).toBeInTheDocument();
  });

  it("says an ended campaign has ended in place of the weekly amount", () => {
    renderRow({ rewardsStatus: "PAST", rewardsCampaignStart: START, rewardsCampaignEnd: END });
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("500,000")).not.toBeInTheDocument();
  });

  it("keeps the weekly amount and leaves the APR out for a live campaign without one", () => {
    renderRow({ rewardsStatus: "LIVE", rewardsApr: null, rewardsCampaignStart: START, rewardsCampaignEnd: END });
    expect(screen.getByText("500,000")).toBeInTheDocument();
    expect(screen.queryByText("Subscribed APR")).not.toBeInTheDocument();
    expect(screen.getByText(WINDOW)).toBeInTheDocument();
  });
});
