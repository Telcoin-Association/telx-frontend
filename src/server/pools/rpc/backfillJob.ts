import "server-only";

import { randomUUID } from "node:crypto";

import { describeError } from "@/app/api/backendHelpers/errors";
import type { RpcChain } from "@/lib/rpc";

import { getRedis } from "../redis";
import { rpcClient } from "./client";
import { runBackfill, type RunDeps } from "./runChain";
import { acquireLock, releaseLock, type RpcRedis } from "./store";

export type BackfillJobResult =
  | { status: 200; body: { done: boolean; nextBlock: number; finalizedBlock: number; chunks: number; warnings: string[] } }
  | { status: 409; body: { error: string } }
  | { status: 500; body: { error: string } };

/**
 * One call of the backfill for the admin route, under the chain's lock (shared with the cron job, so the two
 * never run at once). Errors are logged redacted and answered with a fixed message.
 */
export async function runBackfillJob(chain: RpcChain, options: { reset?: boolean }, deps?: Partial<RunDeps>): Promise<BackfillJobResult> {
  const redis = deps?.redis ?? (getRedis() as unknown as RpcRedis);
  const runId = randomUUID();
  if (!(await acquireLock(redis, chain, runId))) return { status: 409, body: { error: "A run for this chain is in progress" } };
  try {
    const result = await runBackfill(
      chain,
      { client: deps?.client ?? rpcClient(chain), redis, now: deps?.now, config: deps?.config, pools: deps?.pools },
      options,
    );
    for (const warning of result.warnings) console.warn(warning);
    return { status: 200, body: result };
  } catch (err) {
    console.error(`Uniswap ${chain} RPC backfill: ${describeError(err)}`);
    return { status: 500, body: { error: "Backfill failed" } };
  } finally {
    await releaseLock(redis, chain, runId).catch(() => {});
  }
}
