/**
 * @jest-environment node
 */
import { addSwap, dailyRows, DAY, expiredBuckets, HOUR, hourlyRows, trailing24h, type Bucket, type DayRow } from "./buckets";

const AS_OF = 1_800_000_000 - (1_800_000_000 % DAY) + 13 * HOUR + 17 * 60 + 11; // 13:17:11 UTC
const value = (volumeUSD: number) => ({
  volumeUSD,
  feesUSD: volumeUSD / 100,
  lpFeesUSD: volumeUSD / 120,
  protocolFeesUSD: volumeUSD / 100 - volumeUSD / 120,
});

function withSwaps(times: number[]) {
  const buckets = new Map<number, Bucket>();
  const days = new Map<number, DayRow>();
  for (const ts of times) addSwap(buckets, days, ts, value(100));
  return { buckets, days };
}

describe("trailing24h", () => {
  it("counts a swap exactly 24 hours old, and none older than the window's first bucket", () => {
    const { buckets } = withSwaps([AS_OF - DAY, AS_OF - DAY - 400, AS_OF - 60, AS_OF]);
    expect(trailing24h(buckets, AS_OF)).toEqual({ swaps: 3, volumeUSD: 300, feesUSD: 3 });
  });

  it("is zero, not missing, when the window had no swaps", () => {
    const { buckets } = withSwaps([AS_OF - 2 * DAY]);
    expect(trailing24h(buckets, AS_OF)).toEqual({ swaps: 0, volumeUSD: 0, feesUSD: 0 });
  });

  it("ignores buckets after the reference time", () => {
    const { buckets } = withSwaps([AS_OF + 600]);
    expect(trailing24h(buckets, AS_OF).swaps).toBe(0);
  });
});

describe("hourlyRows", () => {
  it("gives 48 rows newest first, with quiet hours as zero", () => {
    const { buckets } = withSwaps([AS_OF - 30, AS_OF - 3 * HOUR, AS_OF - 3 * HOUR + 10]);
    const rows = hourlyRows(buckets, AS_OF, 0);

    expect(rows).toHaveLength(48);
    expect(rows[0]).toEqual({ periodStartUnix: AS_OF - (AS_OF % HOUR), volumeUSD: 100, feesUSD: 1, txCount: 1 });
    expect(rows[1]).toMatchObject({ volumeUSD: 0, txCount: 0 });
    expect(rows[3]).toMatchObject({ volumeUSD: 200, txCount: 2 });
    expect(rows[47].periodStartUnix).toBe(rows[0].periodStartUnix - 47 * HOUR);
  });

  it("starts at the pool's creation hour", () => {
    const rows = hourlyRows(new Map(), AS_OF, AS_OF - 2 * HOUR - 5);
    expect(rows.map(row => row.periodStartUnix)).toEqual([0, 1, 2].map(i => AS_OF - (AS_OF % HOUR) - i * HOUR));
  });
});

describe("dailyRows", () => {
  const today = AS_OF - (AS_OF % DAY);

  it("has one row per day since creation, newest first, carrying the TVL over quiet days", () => {
    const days = new Map<number, DayRow>([
      [today - 3 * DAY, { swaps: 2, volumeUSD: 10, feesUSD: 0.1, lpFeesUSD: 0.08, tvlUSD: 500 }],
      [today, { swaps: 1, volumeUSD: 5, feesUSD: 0.05, lpFeesUSD: 0.04, tvlUSD: 700 }],
    ]);
    expect(dailyRows(days, AS_OF, today - 3 * DAY + 60)).toEqual([
      { timestamp: today, tvlUSD: 700, volumeUSD: 5, feesUSD: 0.05, txCount: 1 },
      { timestamp: today - DAY, tvlUSD: 500, volumeUSD: 0, feesUSD: 0, txCount: 0 },
      { timestamp: today - 2 * DAY, tvlUSD: 500, volumeUSD: 0, feesUSD: 0, txCount: 0 },
      { timestamp: today - 3 * DAY, tvlUSD: 500, volumeUSD: 10, feesUSD: 0.1, txCount: 2 },
    ]);
  });

  it("covers at most 95 days", () => {
    const days = new Map<number, DayRow>([[today - 200 * DAY, { swaps: 0, volumeUSD: 0, feesUSD: 0, lpFeesUSD: 0, tvlUSD: 1 }]]);
    const rows = dailyRows(days, AS_OF, today - 300 * DAY);
    expect(rows).toHaveLength(95);
    expect(rows.at(-1)).toMatchObject({ timestamp: today - 94 * DAY, tvlUSD: 1 });
  });
});

describe("expiredBuckets", () => {
  it("expires buckets past 48 hours, and leaves day rows of any age alone", () => {
    const { buckets, days } = withSwaps([AS_OF - 48 * HOUR - 600, AS_OF - 47 * HOUR, AS_OF - 400 * DAY, AS_OF - 94 * DAY]);
    const expired = expiredBuckets(buckets, AS_OF);

    // Every bucket but the one 47 hours old.
    expect(expired).toHaveLength(3);
    expect([...buckets.keys()].filter(key => !expired.includes(key))).toEqual([AS_OF - 47 * HOUR - ((AS_OF - 47 * HOUR) % 300)]);
    // Day rows are kept for good: expiry only ever names buckets, so a 400-day-old row stays.
    expect([...days.keys()]).toContain(AS_OF - 400 * DAY - ((AS_OF - 400 * DAY) % DAY));
    expect(expired.every(key => buckets.has(key))).toBe(true);
  });
});
