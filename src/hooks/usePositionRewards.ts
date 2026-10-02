"use client";

import { useCallback, useEffect, useState } from "react";
import type { RpcChain } from "@/lib/rpc";
import { positionRewardsUrl, type WalletPositionRewards } from "@/lib/positions";

/** A wallet's per-position TELx rewards as a positions list shows them: loading, read, or unavailable. */
export type PositionRewardsState =
  | { status: "loading" }
  | { status: "ready"; rewards: WalletPositionRewards }
  | { status: "failed" };

/** True for a body shaped like WalletPositionRewards: a `positions` object of numeric `unclaimed` entries. */
export function isWalletPositionRewards(body: unknown): body is WalletPositionRewards {
  if (typeof body !== "object" || body === null) return false;
  const { positions, priceUSD } = body as { positions?: unknown; priceUSD?: unknown };
  if (typeof positions !== "object" || positions === null || Array.isArray(positions)) return false;
  if (priceUSD !== null && typeof priceUSD !== "number") return false;
  return Object.values(positions).every(entry => typeof (entry as { unclaimed?: unknown })?.unclaimed === "number");
}

/**
 * Every position's TELx rewards for `owner` on `chain`, from one request per wallet. `reload` reads them again,
 * for example after a claim. Disabled or without an owner, it stays "loading" and reads nothing.
 */
export function usePositionRewards(chain: RpcChain | undefined, owner: string | undefined, enabled = true) {
  const [state, setState] = useState<PositionRewardsState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setState({ status: "loading" });
    if (!enabled || !chain || !owner) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => fetch(positionRewardsUrl(chain, owner), { signal: controller.signal }))
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => setState(isWalletPositionRewards(body) ? { status: "ready", rewards: body } : { status: "failed" }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [chain, owner, enabled, version]);

  const reload = useCallback(() => setVersion(v => v + 1), []);
  return { state, reload };
}
