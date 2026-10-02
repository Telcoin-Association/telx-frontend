import { rangeTimeline, subscriptionIntervals, type RangeTimelineInput } from "./rangeTimeline";

const base: RangeTimelineInput = {
  from: 0,
  to: 1000,
  tickLower: -100,
  tickUpper: 100,
  startTick: 0,
  ticks: [],
  liquidityAtStart: 10n,
  liquidity: [],
  subscribed: [],
};

describe("rangeTimeline", () => {
  it("counts the whole interval in range when the tick never leaves the range", () => {
    const timeline = rangeTimeline(base);
    expect(timeline).toMatchObject({ activeSeconds: 1000, inRangeSeconds: 1000, outOfRangeSeconds: 0, unknownSeconds: 0 });
    expect(timeline.spans).toEqual([{ from: 0, to: 1000, inRange: true, subscribed: false }]);
  });

  it("splits time at each swap that crosses a range edge, with tickUpper exclusive and tickLower inclusive", () => {
    const timeline = rangeTimeline({
      ...base,
      ticks: [
        { t: 100, tick: 100 },
        { t: 300, tick: 50 },
        { t: 600, tick: -101 },
        { t: 700, tick: -100 },
      ],
    });
    expect(timeline.inRangeSeconds).toBe(100 + 300 + 300);
    expect(timeline.outOfRangeSeconds).toBe(200 + 100);
    expect(timeline.spans.map(span => [span.from, span.to, span.inRange])).toEqual([
      [0, 100, true],
      [100, 300, false],
      [300, 600, true],
      [600, 700, false],
      [700, 1000, true],
    ]);
  });

  it("takes the last swap at the same second", () => {
    const timeline = rangeTimeline({ ...base, ticks: [{ t: 500, tick: 500 }, { t: 500, tick: 0 }] });
    expect(timeline.outOfRangeSeconds).toBe(0);
  });

  it("counts nothing while the position has no liquidity", () => {
    const timeline = rangeTimeline({
      ...base,
      liquidityAtStart: 0n,
      startTick: 500,
      liquidity: [
        { t: 200, d: 10n },
        { t: 400, d: -10n },
        { t: 800, d: 5n },
      ],
    });
    expect(timeline.activeSeconds).toBe(200 + 200);
    expect(timeline.outOfRangeSeconds).toBe(400);
    expect(timeline.spans.map(span => [span.from, span.to])).toEqual([
      [200, 400],
      [800, 1000],
    ]);
  });

  it("marks time unknown until the first swap when the starting tick could not be read", () => {
    const timeline = rangeTimeline({ ...base, startTick: null, ticks: [{ t: 250, tick: 1000 }] });
    expect(timeline).toMatchObject({ unknownSeconds: 250, outOfRangeSeconds: 750, inRangeSeconds: 0 });
  });

  it("counts subscribed time out of range separately", () => {
    const timeline = rangeTimeline({
      ...base,
      ticks: [{ t: 500, tick: 200 }],
      subscribed: [{ from: 100, to: 700 }],
    });
    expect(timeline.subscribedSeconds).toBe(600);
    expect(timeline.subscribedOutOfRangeSeconds).toBe(200);
    expect(timeline.spans.map(span => [span.from, span.to, span.inRange, span.subscribed])).toEqual([
      [0, 100, true, false],
      [100, 500, true, true],
      [500, 700, false, true],
      [700, 1000, false, false],
    ]);
  });

  it("ignores points outside the interval", () => {
    const timeline = rangeTimeline({ ...base, ticks: [{ t: -50, tick: 999 }, { t: 2000, tick: 999 }], liquidity: [{ t: 1500, d: -10n }] });
    expect(timeline.inRangeSeconds).toBe(1000);
  });

  it("keeps the totals but stops adding spans past the limit", () => {
    const ticks = Array.from({ length: 10 }, (_, i) => ({ t: (i + 1) * 50, tick: i % 2 === 0 ? 500 : 0 }));
    const timeline = rangeTimeline({ ...base, ticks, maxSpans: 3 });
    expect(timeline.spans).toHaveLength(3);
    expect(timeline.spansTruncated).toBe(true);
    expect(timeline.inRangeSeconds + timeline.outOfRangeSeconds).toBe(1000);
  });
});

describe("subscriptionIntervals", () => {
  it("pairs subscribes with the next unsubscribe and leaves an open one running", () => {
    expect(
      subscriptionIntervals(
        [
          { t: 10, kind: "subscribed" },
          { t: 20, kind: "unsubscribed" },
          { t: 25, kind: "unsubscribed" },
          { t: 30, kind: "subscribed" },
          { t: 35, kind: "subscribed" },
        ],
        100,
      ),
    ).toEqual([
      { from: 10, to: 20 },
      { from: 30, to: 100 },
    ]);
  });
});
