"use client";

import { useEffect, useState } from "react";
import { parseSvlResponse, type SvlDay } from "@/lib/svl";

/**
 * A Merkl pool's daily subscribed liquidity for the pool page chart. An empty list while it loads, when the read
 * fails, when the pool has no history yet, or when `enabled` is false; the chart then shows no SVL view.
 */
export function usePoolSvl(chain: string | undefined, poolId: string | undefined, enabled: boolean): SvlDay[] {
  const [days, setDays] = useState<SvlDay[]>([]);

  useEffect(() => {
    setDays([]);
    if (!enabled || !chain || !poolId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ chain, poolId });
    fetch(`/api/pools/svl?${query}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(body => setDays(parseSvlResponse(body)))
      .catch(() => {
        if (!controller.signal.aborted) setDays([]);
      });
    return () => controller.abort();
  }, [chain, poolId, enabled]);

  return days;
}
