import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import type { ProtocolsContractData } from "@/web3/getContracts/shared";
import PoolRewards from "./PoolRewards";

jest.mock(
  "../contract/ContractReward",
  () =>
    function ContractReward({ amount, ticker }: { amount: number; ticker: string }) {
      return <span>{`weekly ${amount} ${ticker}`}</span>;
    },
);

const NOW = Date.UTC(2026, 8, 29, 12);

function renderRewards(fields: Record<string, unknown>) {
  const contractData = {
    protocol: "uniswap",
    blockchain: "polygon",
    deprecated: false,
    poolContractAddress: "0xpool",
    rewards: [{ amount: 500000, ticker: "TEL" }],
    rewardsStatus: null,
    rewardsApr: null,
    rewardsDailyRewards: null,
    rewardsCampaignStart: null,
    rewardsCampaignEnd: null,
    ...fields,
  } as unknown as ProtocolsContractData;
  return render(<PoolRewards contractData={contractData} />);
}


// The tooltip trigger whose visible text starts with `text`: the element that carries aria-describedby.
const describedTrigger = (text: string) =>
  screen.getByText((_, el) => !!el?.hasAttribute("aria-describedby") && !!el.textContent?.startsWith(text));

describe("PoolRewards", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it("leads a live campaign with its APR, keeps the weekly amount, and puts daily rewards and the end date on hover", () => {
    const end = Date.UTC(2026, 9, 2);
    renderRewards({
      rewardsStatus: "LIVE",
      rewardsApr: 64.8,
      rewardsDailyRewards: 164.48,
      rewardsCampaignStart: Date.UTC(2026, 8, 25),
      rewardsCampaignEnd: end,
    });
    expect(screen.getByText("64.8% APR")).toBeInTheDocument();
    expect(screen.getByText("500,000 TEL / week")).toBeInTheDocument();
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Rewards: $164.48 per day");
    expect(tip).toHaveTextContent("Campaign ends Oct 2 (UTC)");
    expect(describedTrigger("64.8% APR")).toHaveAccessibleDescription(/\$164\.48 per day/);
  });

  it("explains that the APR is over subscribed liquidity, even without campaign details", () => {
    renderRewards({ rewardsStatus: "LIVE", rewardsApr: 129 });
    expect(screen.getByText("129.0% APR")).toBeInTheDocument();
    expect(describedTrigger("129.0% APR")).toHaveAccessibleDescription(/^Subscribed APR: .*subscribed liquidity/);
  });

  it("shows Ended once a live campaign's end passes in an open tab", () => {
    const end = NOW + 30_000;
    renderRewards({ rewardsStatus: "LIVE", rewardsApr: 64.8, rewardsCampaignEnd: end });
    expect(screen.getByText("64.8% APR")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("64.8% APR")).not.toBeInTheDocument();
  });

  it("shows the Merkl start date of a scheduled campaign over the configured label", () => {
    const start = Date.UTC(2026, 8, 30);
    renderRewards({ blockchain: "base", rewardsStatus: "SOON", rewardsCampaignStart: start });
    expect(screen.getByText("Starting Sep 30")).toBeInTheDocument();
    expect(screen.queryByText("Starting Sept 30th")).not.toBeInTheDocument();
    expect(screen.queryByText(/APR/)).not.toBeInTheDocument();
  });

  it("falls back to the configured start label when a scheduled campaign has no start date", () => {
    renderRewards({ blockchain: "ethereum", rewardsStatus: "SOON" });
    expect(screen.getByText("Starting Oct 7th")).toBeInTheDocument();
  });

  it("says Ended for a past campaign", () => {
    renderRewards({ rewardsStatus: "PAST", rewardsCampaignEnd: Date.UTC(2026, 8, 20, 12) });
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText(/weekly/)).not.toBeInTheDocument();
  });

  it("keeps the weekly rewards without Merkl data", () => {
    renderRewards({});
    expect(screen.getByText("weekly 500000 TEL")).toBeInTheDocument();
    expect(screen.queryByText(/APR/)).not.toBeInTheDocument();
  });

  it("keeps the configured start label without Merkl data", () => {
    renderRewards({ blockchain: "base" });
    expect(screen.getByText("Starting Sept 30th")).toBeInTheDocument();
  });

  it("drops the start label once a campaign is live, even without an APR", () => {
    renderRewards({ blockchain: "base", rewardsStatus: "LIVE" });
    expect(screen.queryByText("Starting Sept 30th")).not.toBeInTheDocument();
    expect(screen.getByText("weekly 500000 TEL")).toBeInTheDocument();
  });
});
