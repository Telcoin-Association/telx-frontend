/**
 * How long a Uniswap v4 position spent in and out of range, from the pool's tick after each swap, the
 * position's liquidity changes, and the times it was subscribed. Time counts only while the position has
 * liquidity: an emptied position is neither in nor out of range.
 */

/** The pool's tick from `t` (unix seconds) until the next point. */
export type TickPoint = { t: number; tick: number };

/** A liquidity change of the position at `t`. */
export type LiquidityPoint = { t: number; d: bigint };

/** A half-open interval `[from, to)` in unix seconds. */
export type Interval = { from: number; to: number };

/** A run of time with liquidity in one range state. `inRange` is null while the pool's tick is unknown. */
export type RangeSpan = Interval & { inRange: boolean | null; subscribed: boolean };

export type RangeTimeline = Interval & {
  /** Seconds with liquidity, split by range state. */
  activeSeconds: number;
  inRangeSeconds: number;
  outOfRangeSeconds: number;
  unknownSeconds: number;
  /** Seconds subscribed with liquidity, and the part of them out of range, which earn no Merkl rewards. */
  subscribedSeconds: number;
  subscribedOutOfRangeSeconds: number;
  /** Runs with liquidity, oldest first. Runs of the same range state that touch are merged. */
  spans: RangeSpan[];
  /** True when the spans were cut at `maxSpans`; the totals still cover the whole interval. */
  spansTruncated: boolean;
};

export type RangeTimelineInput = Interval & {
  tickLower: number;
  tickUpper: number;
  /** The pool's tick at `from`, or null when it could not be read; the first swap then sets it. */
  startTick: number | null;
  /** Swap ticks in time order. Points before `from` are ignored. */
  ticks: readonly TickPoint[];
  /** Liquidity held at `from`. */
  liquidityAtStart: bigint;
  /** Liquidity changes after `from`, in time order. */
  liquidity: readonly LiquidityPoint[];
  subscribed: readonly Interval[];
  maxSpans?: number;
};

export const DEFAULT_MAX_SPANS = 500;

export const isInRange = (tick: number, tickLower: number, tickUpper: number) => tick >= tickLower && tick < tickUpper;

export function rangeTimeline(input: RangeTimelineInput): RangeTimeline {
  const { from, to, tickLower, tickUpper, maxSpans = DEFAULT_MAX_SPANS } = input;
  const ticks = input.ticks.filter(point => point.t >= from && point.t < to);
  const changes = input.liquidity.filter(point => point.t >= from && point.t < to);
  const subscribed = input.subscribed.filter(interval => interval.to > from && interval.from < to);

  const cuts = new Set<number>([from, to]);
  for (const point of ticks) cuts.add(point.t);
  for (const point of changes) cuts.add(point.t);
  for (const interval of subscribed) {
    if (interval.from > from && interval.from < to) cuts.add(interval.from);
    if (interval.to > from && interval.to < to) cuts.add(interval.to);
  }
  const bounds = [...cuts].sort((a, b) => a - b);

  const result: RangeTimeline = {
    from,
    to,
    activeSeconds: 0,
    inRangeSeconds: 0,
    outOfRangeSeconds: 0,
    unknownSeconds: 0,
    subscribedSeconds: 0,
    subscribedOutOfRangeSeconds: 0,
    spans: [],
    spansTruncated: false,
  };

  let tick = input.startTick;
  let liquidity = input.liquidityAtStart;
  let tickIndex = 0;
  let changeIndex = 0;

  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    // Every point at the segment's start applies to it; the last swap in a block sets the tick.
    while (tickIndex < ticks.length && ticks[tickIndex].t <= start) tick = ticks[tickIndex++].tick;
    while (changeIndex < changes.length && changes[changeIndex].t <= start) liquidity += changes[changeIndex++].d;
    if (liquidity <= 0n) continue;

    const seconds = end - start;
    const inRange = tick === null ? null : isInRange(tick, tickLower, tickUpper);
    const isSubscribed = subscribed.some(interval => interval.from <= start && interval.to > start);

    result.activeSeconds += seconds;
    if (inRange === null) result.unknownSeconds += seconds;
    else if (inRange) result.inRangeSeconds += seconds;
    else result.outOfRangeSeconds += seconds;
    if (isSubscribed) {
      result.subscribedSeconds += seconds;
      if (inRange === false) result.subscribedOutOfRangeSeconds += seconds;
    }

    const last = result.spans[result.spans.length - 1];
    if (last && last.to === start && last.inRange === inRange && last.subscribed === isSubscribed) {
      last.to = end;
    } else if (result.spans.length < maxSpans) {
      result.spans.push({ from: start, to: end, inRange, subscribed: isSubscribed });
    } else {
      result.spansTruncated = true;
    }
  }

  return result;
}

/** Subscribe and unsubscribe events of one token, in time order. */
export type SubscriptionEvent = { t: number; kind: "subscribed" | "unsubscribed" };

/**
 * The intervals a token was subscribed, from its events in time order. An unsubscribe with no open
 * subscription is ignored, and a subscription still open runs to `until`.
 */
export function subscriptionIntervals(events: readonly SubscriptionEvent[], until: number): Interval[] {
  const intervals: Interval[] = [];
  let open: number | null = null;
  for (const event of events) {
    if (event.kind === "subscribed") {
      if (open === null) open = event.t;
    } else if (open !== null) {
      intervals.push({ from: open, to: event.t });
      open = null;
    }
  }
  if (open !== null && open < until) intervals.push({ from: open, to: until });
  return intervals;
}
