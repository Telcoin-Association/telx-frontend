/**
 * @jest-environment node
 */
import { rewardsDayKey, type RewardsDayRow } from "./history";
import { readPoolSvl } from "./svlDays";

jest.mock("../redis", () => ({ getRedis: () => { throw new Error("tests pass their own client"); } }));

const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const day = (iso: string) => String(Date.parse(`${iso}T00:00:00Z`) / 1000);

const row = (overrides: Partial<RewardsDayRow> = {}): string =>
  JSON.stringify({
    status: "LIVE",
    apr: 54,
    dailyRewards: 120,
    subscribedTvlUSD: 100_000,
    campaignIds: ["0xabc"],
    campaignStart: null,
    campaignEnd: null,
    pending: false,
    at: 1,
    ...overrides,
  } satisfies RewardsDayRow);

describe("readPoolSvl", () => {
  it("returns live days oldest first, with the backfill's days marked as estimates", async () => {
    const hgetall = jest.fn().mockResolvedValue({
      [day("2026-09-27")]: row({ subscribedTvlUSD: 80_000 }),
      [day("2026-09-25")]: row({ subscribedTvlUSD: 50_000, source: "chain" }),
      [day("2026-09-26")]: row({ subscribedTvlUSD: 60_000, source: "chain" }),
    });

    await expect(readPoolSvl("polygon", POOL, { hgetall })).resolves.toEqual([
      { date: "2026-09-25", svlUSD: 50_000, estimated: true },
      { date: "2026-09-26", svlUSD: 60_000, estimated: true },
      { date: "2026-09-27", svlUSD: 80_000, estimated: false },
    ]);
    expect(hgetall).toHaveBeenCalledWith(rewardsDayKey("polygon", POOL));
  });

  it("leaves out days without a live, measured SVL", async () => {
    const hgetall = jest.fn().mockResolvedValue({
      [day("2026-09-24")]: row({ status: "SOON" }),
      [day("2026-09-25")]: row({ pending: true }),
      [day("2026-09-26")]: row({ subscribedTvlUSD: null }),
      [day("2026-09-27")]: row({ status: "PAST" }),
      [day("2026-09-28")]: "not json",
      [day("2026-09-29")]: row({ subscribedTvlUSD: 1 }),
    });

    await expect(readPoolSvl("polygon", POOL, { hgetall })).resolves.toEqual([{ date: "2026-09-29", svlUSD: 1, estimated: false }]);
  });

  it("returns nothing for a pool with no history yet", async () => {
    await expect(readPoolSvl("base", POOL, { hgetall: jest.fn().mockResolvedValue(null) })).resolves.toEqual([]);
  });
});
