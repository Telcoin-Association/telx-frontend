import { formatApr, formatCampaignWindow, getMerklRewards } from "./poolRewardsDisplay";

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
});
