import React, { useRef } from "react";
import type { LiquiditySegment } from "@/lib/v4/liquidityDistribution";
import { priceAtTick, tickAtPrice, usableTickBounds, type TickRange } from "@/lib/v4/range";
import { formatPrice } from "./PositionHistory";
import { FOCUS_OUTLINE_CLASS } from "../eusdVault/focusOutline";

const WIDTH = 600;
const HEIGHT = 160;
/** Tick spacings a Page Up or Page Down moves a handle. */
const PAGE_STEPS = 10;

type Bound = "lower" | "upper";

/**
 * The pool's liquidity across prices, as Uniswap draws it: bars of active liquidity over a linear price axis, the
 * current price as a dashed line, and the selected range shaded between two handles. The handles drag with a
 * pointer and move one tick spacing per arrow key (ten with Page Up and Page Down); each move is aligned to the
 * tick spacing and keeps the lower handle below the upper one. A full range hides the handles.
 */
export default function RangeChart({
  segments,
  window,
  currentTick,
  range,
  fullRange,
  tickSpacing,
  decimals,
  priceUnit,
  onChange,
  onDragging,
}: {
  segments: LiquiditySegment[] | null;
  window: TickRange;
  currentTick: number;
  range: TickRange | null;
  fullRange: boolean;
  tickSpacing: number;
  decimals: [number, number];
  priceUnit: string;
  onChange(range: TickRange): void;
  onDragging?(dragging: boolean): void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Bound | null>(null);

  const priceLow = priceAtTick(window.tickLower, decimals[0], decimals[1]);
  const priceHigh = priceAtTick(window.tickUpper, decimals[0], decimals[1]);
  const fraction = (tick: number) => Math.min(1, Math.max(0, (priceAtTick(tick, decimals[0], decimals[1]) - priceLow) / (priceHigh - priceLow)));
  const tickAtFraction = (f: number) => tickAtPrice(priceLow + Math.min(1, Math.max(0, f)) * (priceHigh - priceLow), decimals[0], decimals[1]);

  const bounds = usableTickBounds(tickSpacing);
  const move = (bound: Bound, tick: number) => {
    if (!range) return;
    const aligned = Math.round(tick / tickSpacing) * tickSpacing;
    if (bound === "lower") onChange({ tickLower: Math.max(bounds.tickLower, Math.min(aligned, range.tickUpper - tickSpacing)), tickUpper: range.tickUpper });
    else onChange({ tickLower: range.tickLower, tickUpper: Math.min(bounds.tickUpper, Math.max(aligned, range.tickLower + tickSpacing)) });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const bound = dragging.current;
    const area = areaRef.current?.getBoundingClientRect();
    if (!bound || !area || area.width === 0 || !Number.isFinite(event.clientX)) return;
    move(bound, tickAtFraction((event.clientX - area.left) / area.width));
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = null;
    onDragging?.(false);
  };

  const onKeyDown = (bound: Bound) => (event: React.KeyboardEvent) => {
    if (!range) return;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -PAGE_STEPS, PageUp: PAGE_STEPS };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    move(bound, (bound === "lower" ? range.tickLower : range.tickUpper) + step * tickSpacing);
  };

  const maxLiquidity = (segments ?? []).reduce((max, s) => (s.liquidity > max ? s.liquidity : max), 0n);
  const barHeight = (liquidity: bigint) => (maxLiquidity === 0n ? 0 : (Number((liquidity * 1000n) / maxLiquidity) / 1000) * (HEIGHT - 8));
  const shadeFrom = fullRange || !range ? 0 : fraction(range.tickLower);
  const shadeTo = fullRange || !range ? 1 : fraction(range.tickUpper);

  const handle = (bound: Bound) => {
    if (!range || fullRange) return null;
    const tick = bound === "lower" ? range.tickLower : range.tickUpper;
    const price = priceAtTick(tick, decimals[0], decimals[1]);
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={bound === "lower" ? "Min price" : "Max price"}
        aria-valuemin={window.tickLower}
        aria-valuemax={window.tickUpper}
        aria-valuenow={tick}
        aria-valuetext={`${formatPrice(price)} ${priceUnit}`}
        data-testid={`range-handle-${bound}`}
        onKeyDown={onKeyDown(bound)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragging.current = bound;
          onDragging?.(true);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ left: `${fraction(tick) * 100}%` }}
        className={`absolute top-0 bottom-0 z-10 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none justify-center ${FOCUS_OUTLINE_CLASS}`}
      >
        <span className="h-full w-0.5 bg-white" />
        <span className="absolute top-1/2 h-8 w-3 -translate-y-1/2 rounded-sm border border-white bg-accent" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div ref={areaRef} data-testid="range-chart-area" className="relative h-40 w-full select-none overflow-hidden rounded-xl bg-black/20">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <rect x={shadeFrom * WIDTH} y={0} width={Math.max(0, shadeTo - shadeFrom) * WIDTH} height={HEIGHT} className="fill-[#5533ff]/25" />
          {(segments ?? []).map((s) => {
            const x = fraction(s.tickLower) * WIDTH;
            const w = (fraction(s.tickUpper) - fraction(s.tickLower)) * WIDTH;
            const h = barHeight(s.liquidity);
            return <rect key={`${s.tickLower}:${s.tickUpper}`} data-testid="liquidity-bar" x={x} y={HEIGHT - h} width={Math.max(0, w)} height={h} className="fill-[#37aeff]/70" />;
          })}
          <line x1={fraction(currentTick) * WIDTH} x2={fraction(currentTick) * WIDTH} y1={0} y2={HEIGHT} stroke="white" strokeDasharray="4 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {segments === null && <p className="absolute inset-x-0 top-2 text-center text-xs text-primary">Reading the pool&apos;s liquidity...</p>}
        {fullRange && <p className="absolute inset-x-0 top-2 text-center text-xs text-white">Full range: the position earns at every price.</p>}
        {handle("lower")}
        {handle("upper")}
      </div>
      <div className="flex justify-between text-xs text-primary" aria-hidden="true">
        <span>{formatPrice(priceLow)}</span>
        <span className="text-white">Current {formatPrice(priceAtTick(currentTick, decimals[0], decimals[1]))}</span>
        <span>{formatPrice(priceHigh)}</span>
      </div>
    </div>
  );
}
