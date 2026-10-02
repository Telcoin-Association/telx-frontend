import { bitmapWords, chartWindow, liquiditySegments, ticksInWord } from "./liquidityDistribution";
import { usableTickBounds } from "./range";

describe("tick bitmap", () => {
  it("finds the words that hold a tick range, including negative ticks", () => {
    // Spacing 60: a word covers 256 * 60 = 15,360 ticks.
    expect(bitmapWords(0, 15_359, 60)).toEqual([0]);
    expect(bitmapWords(-1, 15_360, 60)).toEqual([-1, 0, 1]);
    expect(bitmapWords(140_000, 141_000, 60)).toEqual([9]);
  });

  it("decodes the initialized ticks a word marks", () => {
    expect(ticksInWord(0, 0n, 60)).toEqual([]);
    expect(ticksInWord(0, (1n << 0n) | (1n << 5n), 60)).toEqual([0, 300]);
    expect(ticksInWord(-1, 1n << 255n, 60)).toEqual([-60]);
    expect(ticksInWord(9, 1n << 3n, 60)).toEqual([(9 * 256 + 3) * 60]);
  });
});

describe("liquiditySegments", () => {
  // Two positions: 100 over [-600, 600) and 50 over [0, 1200).
  const TICKS = [
    { tick: -600, liquidityNet: 100n },
    { tick: 0, liquidityNet: 50n },
    { tick: 600, liquidityNet: -100n },
    { tick: 1200, liquidityNet: -50n },
  ];

  it("walks out from the current price, adding liquidity crossing up and removing it crossing down", () => {
    expect(liquiditySegments({ tickLower: -1200, tickUpper: 1800 }, 300, 150n, TICKS)).toEqual([
      { tickLower: -1200, tickUpper: -600, liquidity: 0n },
      { tickLower: -600, tickUpper: 0, liquidity: 100n },
      { tickLower: 0, tickUpper: 300, liquidity: 150n },
      { tickLower: 300, tickUpper: 600, liquidity: 150n },
      { tickLower: 600, tickUpper: 1200, liquidity: 50n },
      { tickLower: 1200, tickUpper: 1800, liquidity: 0n },
    ]);
  });

  it("treats a current tick on an initialized tick as above it", () => {
    const segments = liquiditySegments({ tickLower: -1200, tickUpper: 1800 }, 0, 150n, TICKS);
    expect(segments.find((s) => s.tickLower === -600)).toEqual({ tickLower: -600, tickUpper: 0, liquidity: 100n });
    expect(segments.find((s) => s.tickLower === 0)).toEqual({ tickLower: 0, tickUpper: 600, liquidity: 150n });
  });

  it("ignores ticks outside the window", () => {
    expect(liquiditySegments({ tickLower: -300, tickUpper: 300 }, 100, 150n, TICKS)).toEqual([
      { tickLower: -300, tickUpper: 0, liquidity: 100n },
      { tickLower: 0, tickUpper: 100, liquidity: 150n },
      { tickLower: 100, tickUpper: 300, liquidity: 150n },
    ]);
  });
});

describe("chartWindow", () => {
  it("shows a factor of two either side of the price for full range", () => {
    expect(chartWindow(usableTickBounds(60), 140_355, 60, true)).toEqual({ tickLower: 133_380, tickUpper: 147_300 });
  });

  it("shows the range and the price with room either side, aligned", () => {
    const window = chartWindow({ tickLower: 137_460, tickUpper: 142_620 }, 140_355, 60, false);
    expect(window.tickLower).toBeLessThan(137_460);
    expect(window.tickUpper).toBeGreaterThan(142_620);
    expect(Math.abs(window.tickLower % 60)).toBe(0);
    expect(Math.abs(window.tickUpper % 60)).toBe(0);
  });

  it("stays inside the usable bounds", () => {
    expect(chartWindow({ tickLower: -887_220, tickUpper: -880_000 }, -884_000, 60, false).tickLower).toBe(-887_220);
  });
});
