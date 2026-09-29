import "server-only";

import { dailyKey, hourlyKey, quickswapKey } from "./cache";
import type { CronWriteOptions } from "./cronWrite";
import { MERKL_JOBS } from "./merkl/store";
import {
  BalancerDailyResponseSchema,
  BalancerHourlyResponseSchema,
  QuickswapGroupedResponseSchema,
  UniswapDailyResponseSchema,
  UniswapHourlyResponseSchema,
} from "./schemas";
import { fetchBalancerHistory, fetchBalancerHourly } from "./subgraphs/balancer";
import { fetchQuickswapGrouped } from "./subgraphs/quickswap";
import { fetchUniswapHistory, fetchUniswapHourly } from "./subgraphs/uniswap";

/**
 * The cron jobs, one per data key, served at /api/cron/<job>. The schedules live in vercel.json:
 * the `*-grouped` split jobs every 5 minutes, the `*-history` jobs and `quickswap-grouped` hourly, and
 * the `merkl-rewards-*` jobs (src/server/pools/merkl) every 10 minutes.
 */
export const CRON_JOBS = {
  "uniswap-base-grouped": {
    key: hourlyKey("uniswap-base"),
    fetch: () => fetchUniswapHourly("base"),
    schema: UniswapHourlyResponseSchema,
    label: "Uniswap base hourly",
  },
  "uniswap-polygon-grouped": {
    key: hourlyKey("uniswap-polygon"),
    fetch: () => fetchUniswapHourly("polygon"),
    schema: UniswapHourlyResponseSchema,
    label: "Uniswap polygon hourly",
  },
  "uniswap-ethereum-grouped": {
    key: hourlyKey("uniswap-ethereum"),
    fetch: () => fetchUniswapHourly("ethereum"),
    schema: UniswapHourlyResponseSchema,
    label: "Uniswap ethereum hourly",
  },
  "balancer-grouped": {
    key: hourlyKey("balancer"),
    fetch: () => fetchBalancerHourly(),
    schema: BalancerHourlyResponseSchema,
    label: "Balancer hourly",
  },
  "uniswap-base-history": {
    key: dailyKey("uniswap-base"),
    fetch: () => fetchUniswapHistory("base"),
    schema: UniswapDailyResponseSchema,
    label: "Uniswap base history",
  },
  "uniswap-polygon-history": {
    key: dailyKey("uniswap-polygon"),
    fetch: () => fetchUniswapHistory("polygon"),
    schema: UniswapDailyResponseSchema,
    label: "Uniswap polygon history",
  },
  "uniswap-ethereum-history": {
    key: dailyKey("uniswap-ethereum"),
    fetch: () => fetchUniswapHistory("ethereum"),
    schema: UniswapDailyResponseSchema,
    label: "Uniswap ethereum history",
  },
  "balancer-history": {
    key: dailyKey("balancer"),
    fetch: () => fetchBalancerHistory(),
    schema: BalancerDailyResponseSchema,
    label: "Balancer history",
  },
  "quickswap-grouped": {
    key: quickswapKey,
    fetch: () => fetchQuickswapGrouped(),
    schema: QuickswapGroupedResponseSchema,
    label: "QuickSwap",
  },
  ...MERKL_JOBS,
} satisfies Record<string, CronWriteOptions>;

export type CronJob = keyof typeof CRON_JOBS;

export function isCronJob(job: string): job is CronJob {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS, job);
}
