import "server-only";

import { svlDateLabel, type SvlDay } from "@/lib/svl";

import { getRedis } from "../redis";
import type { Chain } from "../registry";
import { parseRewardsDays, rewardsDayKey } from "./history";

/** A pool's SVL days from its parsed rewards history: the days a campaign was live and the SVL was known. */
export function svlDaysFrom(rewardsDays: ReturnType<typeof parseRewardsDays>): SvlDay[] {
  const days: SvlDay[] = [];
  for (const [dayStart, row] of rewardsDays) {
    if (row.status !== "LIVE" || row.pending) continue;
    const svlUSD = row.subscribedTvlUSD;
    if (svlUSD === null || !Number.isFinite(svlUSD)) continue;
    days.push({ date: svlDateLabel(dayStart), svlUSD, estimated: row.source === "chain" });
  }
  return days;
}

export type SvlRedis = { hgetall(key: string): Promise<unknown> };

/** Reads one pool's rewards history hash and returns its SVL days, oldest first. */
export async function readPoolSvl(chain: Chain, poolId: string, redis: SvlRedis = getRedis() as unknown as SvlRedis): Promise<SvlDay[]> {
  const hash = await redis.hgetall(rewardsDayKey(chain, poolId));
  return svlDaysFrom(parseRewardsDays(hash && typeof hash === "object" ? (hash as Record<string, unknown>) : null));
}
