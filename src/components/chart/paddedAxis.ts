/**
 * Y axis for a line chart whose values sit far from zero, such as a position's value against holding its deposit.
 * The domain runs from the lowest to the highest value across every plotted series, padded on both ends by a share
 * of that span, so the lines fill the chart and the gap between them stays visible. Ticks fall on a rounded step
 * inside the domain, and the labels carry just enough digits to tell neighbouring ticks apart.
 */

export type PaddedAxis = {
  domain: [number, number];
  ticks: number[];
  step: number;
};

/** Share of the span added below the lowest and above the highest value. */
export const AXIS_PADDING = 0.05;

/** Step multipliers per power of ten. */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** The smallest rounded step (1, 2, 2.5 or 5 times a power of ten) at least `raw`. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = NICE_STEPS.find(multiple => multiple * power >= raw * (1 - 1e-9)) ?? 10;
  return step * power;
}

/** Decimal places that `value` needs, up to `max`, so a step of 2.5 keeps its .5 and 0.02 keeps both places. */
function decimalsOf(value: number, max = 6): number {
  for (let places = 0; places < max; places++) {
    const scaled = value * 10 ** places;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, Math.abs(scaled))) return places;
  }
  return max;
}

/**
 * The padded domain and rounded ticks for `values`, ignoring nulls and non-finite numbers. When every value is
 * (about) the same, the padding is that share of the value itself, or 1 when the value is 0. A domain over values
 * that are all zero or more never drops below zero. The step is the rounded step that splits the domain into at most
 * about `intervals` parts. Null when there is nothing to plot.
 */
export function paddedAxis(values: Iterable<number | null | undefined>, { padding = AXIS_PADDING, intervals = 5 } = {}): PaddedAxis | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min > max) return null;

  const span = max - min;
  const scale = Math.max(Math.abs(min), Math.abs(max));
  const flat = span <= scale * 1e-9;
  const pad = flat ? (scale > 0 ? scale * padding : 1) : span * padding;
  const lower = min >= 0 ? Math.max(0, min - pad) : min - pad;
  const upper = max + pad;

  const step = niceStep((upper - lower) / Math.max(1, intervals));
  const places = decimalsOf(step);
  const ticks: number[] = [];
  for (let tick = Math.ceil(lower / step - 1e-9) * step; tick <= upper + step * 1e-9; tick += step) {
    ticks.push(Number(tick.toFixed(places)));
  }
  return { domain: [lower, upper], ticks, step };
}

const UNITS: ReadonlyArray<[number, string]> = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * A USD tick formatter for `axis`: compact like the other chart axes ("$1.2K", "$950"), with as many decimals as the
 * step needs in the chosen unit, so ticks $20 apart near $1,000 read "$1.02K" and "$1.04K" rather than "$1K" twice.
 */
export function usdTickFormatter(axis: Pick<PaddedAxis, "ticks" | "step">): (value: number) => string {
  const largest = Math.max(0, ...axis.ticks.map(Math.abs));
  const [unit, suffix] = UNITS.find(([size]) => largest >= size) ?? [1, ""];
  const places = decimalsOf(axis.step / unit, 4);
  const format = new Intl.NumberFormat("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
  return value => {
    if (!Number.isFinite(value)) return "";
    const sign = value < 0 ? "-" : "";
    return `${sign}$${format.format(Math.abs(value) / unit)}${suffix}`;
  };
}

/** Pixels per character of an 11px axis label, and room for the tick mark and gap beside it. */
const CHAR_WIDTH = 6.6;
const TICK_ROOM = 14;

/** An axis width that fits the widest of `labels` at the 11px axis font, so no label's first digit is clipped. */
export function axisWidth(labels: readonly string[], minimum = 40): number {
  const longest = Math.max(0, ...labels.map(label => label.length));
  return Math.max(minimum, Math.ceil(longest * CHAR_WIDTH + TICK_ROOM));
}
