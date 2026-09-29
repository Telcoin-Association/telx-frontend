/**
 * @jest-environment node
 */
import { deriveBalancerMetrics, deriveMetrics, deriveQuickswapMetrics, deriveUniswapMetrics, toNumber } from "./metrics";

const DAY = 86400;
const DAY_START = 20510 * DAY; // a UTC midnight
const NOW = DAY_START + 12 * 3600; // midday UTC

describe("toNumber", () => {
  it("converts numeric strings and numbers", () => {
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(3)).toBe(3);
    expect(toNumber("0")).toBe(0);
  });

  it("treats NaN, blanks, null and non-numeric types as missing", () => {
    expect(toNumber("abc")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("  ")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
    expect(toNumber({})).toBeNull();
  });
});

describe("deriveUniswapMetrics", () => {
  const pool = { id: "0xabc", totalValueLockedUSD: "1250.5", feesUSD: "10", createdAtTimestamp: "1767225600" };

  it("returns zeros and a null lastActivityAt for a pool with no rows", () => {
    expect(deriveUniswapMetrics({ pool, poolSnapshots: [] }, NOW)).toEqual({
      tvlUSD: 1250.5,
      volume24h: 0,
      fees24h: 0,
      window: "trailing-24h",
      lastActivityAt: null,
      lastSwapAt: null,
      createdAt: 1767225600,
      rows24h: 0,
      computedAt: NOW,
    });
  });

  it("returns nulls when the pool entity is missing", () => {
    const rows = [{ periodStartUnix: NOW - 3600, volumeUSD: "5", feesUSD: "0.015" }];
    const metrics = deriveUniswapMetrics({ pool: null, poolSnapshots: rows }, NOW);

    expect(metrics.tvlUSD).toBeNull();
    expect(metrics.volume24h).toBeNull();
    expect(metrics.fees24h).toBeNull();
    expect(metrics.window).toBeNull();
    expect(metrics.createdAt).toBeNull();
    expect(deriveUniswapMetrics({}, NOW)).toEqual({
      tvlUSD: null,
      volume24h: null,
      fees24h: null,
      window: null,
      lastActivityAt: null,
      lastSwapAt: null,
      createdAt: null,
      rows24h: 0,
      computedAt: NOW,
    });
  });

  it("includes the row exactly at now - 24h and excludes older rows", () => {
    const rows = [
      { periodStartUnix: NOW, volumeUSD: "0", feesUSD: "0" },
      { periodStartUnix: NOW - 3600, volumeUSD: "5", feesUSD: "0.015" },
      { periodStartUnix: NOW - DAY, volumeUSD: "10", feesUSD: "0.03" },
      { periodStartUnix: NOW - DAY - 1, volumeUSD: "1000", feesUSD: "3" },
    ];
    const metrics = deriveUniswapMetrics({ pool, poolSnapshots: rows }, NOW);

    expect(metrics.volume24h).toBe(15);
    expect(metrics.fees24h).toBeCloseTo(0.045, 10);
    expect(metrics.rows24h).toBe(3);
    expect(metrics.lastActivityAt).toBe(NOW);
    expect(metrics.lastSwapAt).toBe(NOW - 3600);
  });

  it("treats unparseable values as missing instead of zero", () => {
    const rows = [
      { periodStartUnix: NOW - 60, volumeUSD: "not-a-number", feesUSD: "0.5" },
      { periodStartUnix: "bad", volumeUSD: "100", feesUSD: "1" },
    ];
    const metrics = deriveUniswapMetrics({ pool: { totalValueLockedUSD: "" }, poolSnapshots: rows }, NOW);

    expect(metrics.tvlUSD).toBeNull();
    expect(metrics.createdAt).toBeNull();
    expect(metrics.volume24h).toBe(0);
    expect(metrics.fees24h).toBe(0.5);
    expect(metrics.rows24h).toBe(1);
    expect(metrics.lastSwapAt).toBeNull();
  });

  it("returns null volume when the hourly rows are absent", () => {
    const metrics = deriveUniswapMetrics({ pool }, NOW);

    expect(metrics.tvlUSD).toBe(1250.5);
    expect(metrics.volume24h).toBeNull();
    expect(metrics.fees24h).toBeNull();
    expect(metrics.window).toBeNull();
  });
});

describe("deriveBalancerMetrics", () => {
  const pool = { id: "0xpool", address: "0xaddr", totalLiquidity: "5000", totalSwapFee: "20", swapFee: "0.002", createTime: 1700000000 };
  const snapshot = (timestamp: number, swapVolume: string, swapFees: string) => ({ timestamp, swapVolume, swapFees, pool: { id: "0xpool" } });

  describe("swaps path", () => {
    it("sums swaps inside the trailing 24h and derives fees from swapFee", () => {
      const swaps = [
        { timestamp: NOW - 60, valueUSD: "50.5", poolId: { id: "0xpool" } },
        { timestamp: NOW - DAY, valueUSD: "100", poolId: { id: "0xpool" } },
        { timestamp: NOW - DAY - 1, valueUSD: "999", poolId: { id: "0xpool" } },
      ];
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots: [snapshot(DAY_START, "10", "0.02")], swaps }, NOW);

      expect(metrics).toEqual({
        tvlUSD: 5000,
        volume24h: 150.5,
        fees24h: expect.closeTo(0.301, 10),
        window: "trailing-24h",
        lastActivityAt: NOW - 60,
        lastSwapAt: NOW - 60,
        createdAt: 1700000000,
        rows24h: 2,
        computedAt: NOW,
      });
    });

    it("returns zeros for an empty swaps array and falls back to snapshots for lastActivityAt", () => {
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots: [snapshot(DAY_START - DAY, "10", "0.02")], swaps: [] }, NOW);

      expect(metrics.volume24h).toBe(0);
      expect(metrics.fees24h).toBe(0);
      expect(metrics.window).toBe("trailing-24h");
      expect(metrics.rows24h).toBe(0);
      expect(metrics.lastSwapAt).toBeNull();
      expect(metrics.lastActivityAt).toBe(DAY_START - DAY);
    });

    it("returns null fees when swapFee is missing", () => {
      const swaps = [{ timestamp: NOW - 60, valueUSD: "40" }];
      const metrics = deriveBalancerMetrics({ pool: { totalLiquidity: "1" }, poolSnapshots: [], swaps }, NOW);

      expect(metrics.volume24h).toBe(40);
      expect(metrics.fees24h).toBeNull();
    });
  });

  describe("interpolation path (no swaps selection)", () => {
    it("interpolates linearly between the day ends of the snapshots", () => {
      // A snapshot stamped T holds the totals as of the last event in [T, T + 1 day). The cutoff,
      // yesterday at midday, is halfway through the day-1 snapshot's day. Input order does not matter.
      const poolSnapshots = [snapshot(DAY_START, "1900", "3.8"), snapshot(DAY_START - 2 * DAY, "1000", "2"), snapshot(DAY_START - DAY, "1600", "3.2")];
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots }, NOW);

      expect(metrics.volume24h).toBeCloseTo(600, 10);
      expect(metrics.fees24h).toBeCloseTo(1.2, 10);
      expect(metrics.window).toBe("trailing-24h-interpolated");
      expect(metrics.lastSwapAt).toBe(DAY_START);
      expect(metrics.lastActivityAt).toBe(DAY_START);
      expect(metrics.rows24h).toBe(1);
    });

    it("attributes a whole day's swaps to the window when the day ended less than 24h ago", () => {
      // At 01:00 with no snapshot for today, yesterday's swaps are almost all inside the window.
      const poolSnapshots = [snapshot(DAY_START - 2 * DAY, "100", "0.2"), snapshot(DAY_START - DAY, "200", "0.4")];
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots }, DAY_START + 3600);

      expect(metrics.volume24h).toBeCloseTo(100 - 100 / 24, 10);
      expect(metrics.fees24h).toBeCloseTo(0.2 - 0.2 / 24, 10);
    });

    it("uses the snapshot value when the cutoff lands exactly on a day end", () => {
      const poolSnapshots = [snapshot(DAY_START - 2 * DAY, "500", "1"), snapshot(DAY_START - DAY, "1000", "2"), snapshot(DAY_START, "1600", "3.2")];
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots }, DAY_START + DAY);

      expect(metrics.volume24h).toBe(600);
      expect(metrics.fees24h).toBeCloseTo(1.2, 10);
    });

    it("returns 0 when the cutoff is at or after the end of the newest snapshot's day", () => {
      const poolSnapshots = [snapshot(DAY_START - DAY, "1000", "2"), snapshot(DAY_START, "1600", "3.2")];

      for (const now of [DAY_START + 2 * DAY, DAY_START + 2 * DAY + 1]) {
        const metrics = deriveBalancerMetrics({ pool, poolSnapshots }, now);
        expect(metrics.volume24h).toBe(0);
        expect(metrics.fees24h).toBe(0);
        expect(metrics.window).toBe("trailing-24h-interpolated");
        expect(metrics.lastSwapAt).toBe(DAY_START);
      }
    });

    it("returns null when the cutoff is before the first day end", () => {
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots: [snapshot(DAY_START, "1600", "3.2")] }, NOW);

      expect(metrics.volume24h).toBeNull();
      expect(metrics.fees24h).toBeNull();
      expect(metrics.window).toBeNull();
      expect(metrics.lastSwapAt).toBeNull();
      expect(metrics.lastActivityAt).toBe(DAY_START);
      expect(metrics.tvlUSD).toBe(5000);
    });

    it("sets lastSwapAt to the newest snapshot whose cumulative volume grew", () => {
      const poolSnapshots = [snapshot(DAY_START - 2 * DAY, "1000", "2"), snapshot(DAY_START - DAY, "1600", "3.2"), snapshot(DAY_START, "1600", "3.2")];
      const metrics = deriveBalancerMetrics({ pool, poolSnapshots }, NOW);

      expect(metrics.lastSwapAt).toBe(DAY_START - DAY);
      expect(metrics.lastActivityAt).toBe(DAY_START);
      // Half of day-1's 600 falls inside the trailing window that starts at yesterday midday.
      expect(metrics.volume24h).toBeCloseTo(300, 10);
    });
  });

  it("returns zeros and a null lastActivityAt for a pool with no rows", () => {
    expect(deriveBalancerMetrics({ pool, poolSnapshots: [] }, NOW)).toEqual({
      tvlUSD: 5000,
      volume24h: 0,
      fees24h: 0,
      window: "trailing-24h-interpolated",
      lastActivityAt: null,
      lastSwapAt: null,
      createdAt: 1700000000,
      rows24h: 0,
      computedAt: NOW,
    });
  });

  it("returns nulls when the pool entity is missing", () => {
    const metrics = deriveBalancerMetrics({ poolSnapshots: [snapshot(DAY_START, "10", "0.02")], swaps: [{ timestamp: NOW - 60, valueUSD: "5" }] }, NOW);

    expect(metrics.tvlUSD).toBeNull();
    expect(metrics.volume24h).toBeNull();
    expect(metrics.fees24h).toBeNull();
    expect(metrics.window).toBeNull();
    expect(metrics.createdAt).toBeNull();
  });
});

describe("deriveQuickswapMetrics", () => {
  const pool = { id: "0xpair", reserveUSD: "20000", createdAtTimestamp: "1600000000" };
  const day = (date: number, dailyVolumeUSD: string) => ({ date, dailyVolumeUSD, poolAddress: "0xpair" });

  it("uses today's row when the newest row is for the current UTC day", () => {
    const metrics = deriveQuickswapMetrics({ pool, poolSnapshots: [day(DAY_START - DAY, "50"), day(DAY_START, "200")] }, NOW);

    expect(metrics).toEqual({
      tvlUSD: 20000,
      volume24h: 200,
      fees24h: expect.closeTo(0.6, 10),
      window: "utc-day",
      lastActivityAt: DAY_START,
      lastSwapAt: DAY_START,
      createdAt: 1600000000,
      rows24h: 1,
      computedAt: NOW,
    });
  });

  it("returns 0 when the newest row is from an earlier day", () => {
    const metrics = deriveQuickswapMetrics({ pool, poolSnapshots: [day(DAY_START - DAY, "50")] }, NOW);

    expect(metrics.volume24h).toBe(0);
    expect(metrics.fees24h).toBe(0);
    expect(metrics.window).toBe("utc-day");
    expect(metrics.rows24h).toBe(0);
    expect(metrics.lastActivityAt).toBe(DAY_START - DAY);
    expect(metrics.lastSwapAt).toBe(DAY_START - DAY);
  });

  it("keeps lastSwapAt on the last day with volume when today's row is zero", () => {
    const metrics = deriveQuickswapMetrics({ pool, poolSnapshots: [day(DAY_START, "0"), day(DAY_START - DAY, "50")] }, NOW);

    expect(metrics.volume24h).toBe(0);
    expect(metrics.rows24h).toBe(1);
    expect(metrics.lastActivityAt).toBe(DAY_START);
    expect(metrics.lastSwapAt).toBe(DAY_START - DAY);
  });

  it("returns zeros and a null lastActivityAt for a pool with no rows", () => {
    const metrics = deriveQuickswapMetrics({ pool, poolSnapshots: [] }, NOW);

    expect(metrics.volume24h).toBe(0);
    expect(metrics.fees24h).toBe(0);
    expect(metrics.window).toBe("utc-day");
    expect(metrics.lastActivityAt).toBeNull();
    expect(metrics.lastSwapAt).toBeNull();
    expect(metrics.rows24h).toBe(0);
    expect(metrics.tvlUSD).toBe(20000);
  });

  it("returns nulls when the pool entity is missing", () => {
    const metrics = deriveQuickswapMetrics({ poolSnapshots: [day(DAY_START, "200")] }, NOW);

    expect(metrics.tvlUSD).toBeNull();
    expect(metrics.volume24h).toBeNull();
    expect(metrics.fees24h).toBeNull();
    expect(metrics.window).toBeNull();
  });
});

describe("deriveMetrics", () => {
  it("dispatches on protocol", () => {
    const group = { pool: { totalValueLockedUSD: "1", totalLiquidity: "2", reserveUSD: "3" }, poolSnapshots: [] };

    expect(deriveMetrics("uniswap", group, NOW).tvlUSD).toBe(1);
    expect(deriveMetrics("balancer", group, NOW).tvlUSD).toBe(2);
    expect(deriveMetrics("quickswap", group, NOW).tvlUSD).toBe(3);
  });
});
