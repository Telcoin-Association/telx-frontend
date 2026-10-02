"use client";

import { useEffect, useState } from "react";
import type { RpcChain } from "@/lib/rpc";
import { poolRewardsUrl, type PoolRewardsIndex } from "@/lib/positions";

/** A pool's per-position TELx rewards as a positions list shows them: loading, read, or unavailable. */
export type PositionRewardsState = { status: "loading" } | { status: "ready"; rewards: PoolRewardsIndex } | { status: "failed" };

/** True for a body shaped like PoolRewardsIndex: a `positions` object whose entries carry numeric rewards. */
export function isPoolRewardsIndex(body: unknown): body is PoolRewardsIndex {
  if (typeof body !== "object" || body === null) return false;
  const { positions, unresolved } = body as { positions?: unknown; unresolved?: unknown };
  if (typeof positions !== "object" || positions === null || Array.isArray(positions) || typeof unresolved !== "number") return false;
  return Object.values(positions).every(entry => {
    const e = entry as { reward?: unknown; claimable?: unknown; pending?: unknown; final?: unknown } | null;
    return typeof e?.reward === "number" && typeof e.claimable === "number" && typeof e.pending === "number" && typeof e.final === "boolean";
  });
}

/**
 * Every position's TELx rewards in the pool `poolId` on `chain`, from the pool's shared rewards index: one request
 * for the whole list, the same for every visitor. Disabled, it stays "loading" and reads nothing.
 */
export function usePoolRewards(chain: RpcChain | undefined, poolId: string | undefined, enabled = true): PositionRewardsState {
  const [state, setState] = useState<PositionRewardsState>({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    if (!enabled || !chain || !poolId) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => fetch(poolRewardsUrl(chain, poolId), { signal: controller.signal }))
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => setState(isPoolRewardsIndex(body) ? { status: "ready", rewards: body } : { status: "failed" }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [chain, poolId, enabled]);

  return state;
}
