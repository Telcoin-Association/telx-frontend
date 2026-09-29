import { formatApr, formatCampaignWindow, formatShareOfTvl, getMerklRewards, getSubscribedValue, subscribedShare } from "./poolRewardsDisplay";

const now = new Date(Date.UTC(2026, 8, 29, 12));
const shortDate = (ms: number) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(ms));

describe("poolRewardsDisplay", () => {
  it("reads the Merkl fields, null when missing or not a finite number", () => {
    expect(getMerklRewards({ protocol: "quickswap" })).toEqual({ status: null, apr: null, dailyRewards: null, campaignStart: null, campaignEnd: null });
    expect(getMerklRewards({ rewardsStatus: "LIVE", rewardsApr: 64.8, rewardsDailyRewards: Number.NaN })).toMatchObject({
      status: "LIVE",
      apr: 64.8,
      dailyRewards: null,
    });
    expect(getMerklRewards({ rewardsStatus: "OTHER" }).status).toBeNull();
    expect(getMerklRewards(undefined).status).toBeNull();
  });

  it("formats the APR to one decimal", () => {
    expect(formatApr(64.8)).toBe("64.8% APR");
    expect(formatApr(128.98)).toBe("129.0% APR");
    expect(formatApr(1234.56)).toBe("1,234.6% APR");
  });

  it("formats the campaign window from whichever dates are known", () => {
    const start = Date.UTC(2026, 8, 25, 12);
    const end = Date.UTC(2026, 9, 2, 12);
    expect(formatCampaignWindow(start, end, now)).toBe(`${shortDate(start)} - ${shortDate(end)}`);
    expect(formatCampaignWindow(start, null, now)).toBe(`From ${shortDate(start)}`);
    expect(formatCampaignWindow(null, end, now)).toBe(`Until ${shortDate(end)}`);
    expect(formatCampaignWindow(null, null, now)).toBeNull();
  });

  describe("subscribed value", () => {
    const live = { protocol: "uniswap", rewardsStatus: "LIVE", subscribedTvlUSD: 61_200, totalLiquidity: 180_000 };

    it("is the subscribed TVL of a live campaign with its share of TVL", () => {
      expect(getSubscribedValue(live)).toEqual({ kind: "value", usd: 61_200, share: 0.34 });
    });

    it("has no share when TVL is unknown or zero", () => {
      expect(getSubscribedValue({ ...live, totalLiquidity: null })).toEqual({ kind: "value", usd: 61_200, share: null });
      expect(getSubscribedValue({ ...live, totalLiquidity: 0 })).toEqual({ kind: "value", usd: 61_200, share: null });
    });

    it("is unavailable for a live campaign without a subscribed TVL", () => {
      expect(getSubscribedValue({ ...live, subscribedTvlUSD: null })).toEqual({ kind: "unavailable" });
    });

    it("is not started for a scheduled campaign, and none for an ended one, no campaign or another protocol", () => {
      expect(getSubscribedValue({ ...live, rewardsStatus: "SOON" })).toEqual({ kind: "not-started" });
      expect(getSubscribedValue({ ...live, rewardsStatus: "PAST" })).toEqual({ kind: "none" });
      expect(getSubscribedValue({ ...live, rewardsStatus: null })).toEqual({ kind: "none" });
      expect(getSubscribedValue({ ...live, protocol: "balancer" })).toEqual({ kind: "none" });
    });

    it("caps the share at 100% and formats small shares as <1%", () => {
      expect(subscribedShare(110, 100)).toBe(1);
      expect(formatShareOfTvl(0.34)).toBe("34% of TVL");
      expect(formatShareOfTvl(0.004)).toBe("<1% of TVL");
      expect(formatShareOfTvl(0)).toBe("0% of TVL");
    });
  });
});
