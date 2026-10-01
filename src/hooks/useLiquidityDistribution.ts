import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { bitmapWords, liquiditySegments, ticksInWord, type InitializedTick, type LiquiditySegment } from "@/lib/v4/liquidityDistribution";
import { STATE_VIEW, stateViewAbi } from "@/lib/v4/positionManager";
import type { TickRange } from "@/lib/v4/range";
import type { PositionChainId } from "./usePositionActions";

/** Bitmap words read for one chart window, at most; a wider window is read in part. */
export const MAX_WORDS = 24;
/** Initialized ticks read for one chart window, at most. */
export const MAX_TICKS = 400;

/**
 * The pool's liquidity across `window`, read from StateView on the pool's chain: the tick bitmap words covering the
 * window, then the `liquidityNet` of each initialized tick in it. Ticks already read are kept, so moving the window
 * reads only new words. Null until the first read finishes, or when it fails.
 */
export function useLiquidityDistribution({
  chainId,
  poolId,
  tickSpacing,
  window,
  currentTick,
  activeLiquidity,
}: {
  chainId: PositionChainId;
  poolId: string;
  tickSpacing: number | undefined;
  window: TickRange | null;
  currentTick: number | undefined;
  activeLiquidity: bigint | undefined;
}): LiquiditySegment[] | null {
  const publicClient = usePublicClient({ chainId });
  const words = useRef(new Map<number, InitializedTick[]>());
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  // A new pool or chain starts from nothing.
  useEffect(() => {
    words.current = new Map();
    setVersion((v) => v + 1);
  }, [poolId, chainId]);

  const lower = window?.tickLower;
  const upper = window?.tickUpper;
  useEffect(() => {
    if (!publicClient || tickSpacing === undefined || lower === undefined || upper === undefined) return;
    const stateView = STATE_VIEW[chainId];
    const id = poolId as Hex;
    const missing = bitmapWords(lower, upper, tickSpacing)
      .filter((word) => !words.current.has(word))
      .slice(0, MAX_WORDS);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const bitmaps = await Promise.all(missing.map((word) => publicClient.readContract({ address: stateView, abi: stateViewAbi, functionName: "getTickBitmap", args: [id, word] })));
      const ticks = missing.flatMap((word, i) => ticksInWord(word, bitmaps[i], tickSpacing).map((tick) => ({ word, tick }))).slice(0, MAX_TICKS);
      const nets = await Promise.all(ticks.map(({ tick }) => publicClient.readContract({ address: stateView, abi: stateViewAbi, functionName: "getTickLiquidity", args: [id, tick] })));
      if (cancelled) return;
      for (const word of missing) words.current.set(word, []);
      ticks.forEach(({ word, tick }, i) => words.current.get(word)?.push({ tick, liquidityNet: nets[i][1] }));
      setFailed(false);
      setVersion((v) => v + 1);
    })().catch((err) => {
      console.error("Reading the pool's liquidity distribution failed", err);
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [publicClient, chainId, poolId, tickSpacing, lower, upper]);

  if (failed || lower === undefined || upper === undefined || tickSpacing === undefined || currentTick === undefined || activeLiquidity === undefined) return null;
  // `version` changes whenever `words` does, so the segments follow each read.
  void version;
  const needed = bitmapWords(lower, upper, tickSpacing);
  if (!needed.slice(0, MAX_WORDS).every((word) => words.current.has(word))) return null;
  const ticks = needed.flatMap((word) => words.current.get(word) ?? []);
  return liquiditySegments({ tickLower: lower, tickUpper: upper }, currentTick, activeLiquidity, ticks);
}
