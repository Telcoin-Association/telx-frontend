import { formatApr, formatCampaignDate, formatCampaignWindow, formatShareOfTvl, getMerklRewards, getSubscribedValue, subscribedShare } from "./poolRewardsDisplay";
import formatShortDate from "./formatShortDate";

const now = new Date(Date.UTC(2026, 8, 29, 12));
// Campaigns start and end at 00:00 UTC, the moment a local-time formatter moves to the previous day west of UTC.
const START = Date.UTC(2026, 8, 25);
const END = Date.UTC(2026, 9, 2);

describe("poolRewardsDisplay", () => {
  it("reads a live campaign Merkl has not measured as pending, and never an ended or scheduled one", () => {
    const now = Date.UTC(2026, 8, 30, 20);
    const live = { protocol: "uniswap", rewardsStatus: "LIVE", rewardsPending: true, rewardsApr: null, subscribedTvlUSD: null, totalLiquidity: 30_000 };
    expect(getMerklRewards(live, now)).toMatchObject({ status: "LIVE", apr: null, pending: true });
    expect(getSubscribedValue(live, now)).toEqual({ kind: "pending" });
    expect(getMerklRewards({ ...live, rewardsStatus: "SOON" }, now).pending).toBe(false);
    expect(getMerklRewards({ ...live, rewardsCampaignEnd: now - 1 }, now)).toMatchObject({ status: "PAST", pending: false });
  });

  it("reads the Merkl fields, null when missing or not a finite number", () => {
    expect(getMerklRewards({ protocol: "quickswap" })).toEqual({ status: null, apr: null, dailyRewards: null, campaignStart: null, campaignEnd: null, pending: false });
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

  it("formats the campaign window in UTC days from whichever dates are known", () => {
    expect(formatCampaignWindow(START, END, now)).toBe("Sep 25 - Oct 2 (UTC)");
    expect(formatCampaignWindow(START, null, now)).toBe("From Sep 25 (UTC)");
    expect(formatCampaignWindow(null, END, now)).toBe("Until Oct 2 (UTC)");
    expect(formatCampaignWindow(null, null, now)).toBeNull();
  });

  it("formats a 00:00 UTC boundary as that UTC day, whatever the viewer's time zone", () => {
    expect(formatCampaignDate(Date.UTC(2026, 8, 30), now)).toBe("Sep 30");
    expect(formatCampaignDate(Date.UTC(2027, 0, 1), now)).toBe("Jan 1, 2027");
  });

  it("never throws on a date no Date can hold", () => {
    expect(() => formatShortDate(1.79e15)).not.toThrow();
    expect(formatShortDate(1.79e15)).toBe("an unknown date");
    expect(formatShortDate(Number.NaN)).toBe("an unknown date");
  });

  it("reads a campaign date outside the range of a real date as unknown", () => {
    expect(getMerklRewards({ rewardsStatus: "LIVE", rewardsCampaignStart: START, rewardsCampaignEnd: 1.79e18 }, START)).toMatchObject({
      status: "LIVE",
      campaignStart: START,
      campaignEnd: null,
    });
    expect(getMerklRewards({ rewardsStatus: "SOON", rewardsCampaignStart: -1 }).campaignStart).toBeNull();
  });

  it("reads a live campaign as ended once its end has passed, without an APR or daily rewards", () => {
    const live = { rewardsStatus: "LIVE", rewardsApr: 64.8, rewardsDailyRewards: 164.48, rewardsCampaignEnd: END };
    expect(getMerklRewards(live, END - 1)).toMatchObject({ status: "LIVE", apr: 64.8, dailyRewards: 164.48 });
    expect(getMerklRewards(live, END)).toMatchObject({ status: "PAST", apr: null, dailyRewards: null, campaignEnd: END });
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

    it("is unavailable, not no campaign, when the rewards could not be read", () => {
      expect(getSubscribedValue({ ...live, rewardsKnown: false, rewardsStatus: null, subscribedTvlUSD: null })).toEqual({ kind: "unavailable" });
      expect(getSubscribedValue({ ...live, rewardsKnown: true, rewardsStatus: null })).toEqual({ kind: "none" });
    });

    it("drops a live campaign once its end has passed", () => {
      const ending = { ...live, rewardsCampaignEnd: END };
      expect(getSubscribedValue(ending, END - 1)).toMatchObject({ kind: "value" });
      expect(getSubscribedValue(ending, END)).toEqual({ kind: "none" });
    });

    it("is not started for a scheduled campaign, and none for an ended one, no campaign or another protocol", () => {
      expect(getSubscribedValue({ ...live, rewardsStatus: "SOON" })).toEqual({ kind: "not-started" });
      expect(getSubscribedValue({ ...live, rewardsStatus: "PAST" })).toEqual({ kind: "none" });
      expect(getSubscribedValue({ ...live, rewardsStatus: null })).toEqual({ kind: "none" });
      expect(getSubscribedValue({ ...live, protocol: "balancer" })).toEqual({ kind: "none" });
    });

    it("keeps a share above 100% and never rounds either end to a misleading value", () => {
      expect(subscribedShare(110, 100)).toBeCloseTo(1.1);
      expect(formatShareOfTvl(0.34)).toBe("34% of TVL");
      expect(formatShareOfTvl(0.004)).toBe("<1% of TVL");
      expect(formatShareOfTvl(0)).toBe("0% of TVL");
      expect(formatShareOfTvl(0.994)).toBe("99% of TVL");
      expect(formatShareOfTvl(0.995)).toBe(">99% of TVL");
      expect(formatShareOfTvl(0.9999)).toBe(">99% of TVL");
      expect(formatShareOfTvl(1)).toBe("100% of TVL");
      expect(formatShareOfTvl(1.005)).toBe("100% of TVL");
      expect(formatShareOfTvl(1.1)).toBe("Over 100% of TVL");
      expect(formatShareOfTvl(3)).toBe("Over 100% of TVL");
    });
  });
});
