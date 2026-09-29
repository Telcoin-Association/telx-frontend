import "server-only";

import { BaseError, createPublicClient, HttpRequestError, type Hex } from "viem";

import { alchemyTransport } from "@/app/api/backendHelpers/alchemy";
import { describeError, redactSecrets } from "@/app/api/backendHelpers/errors";
import type { RpcChain } from "@/lib/rpc";
import { toHex, type RpcRequester } from "@/server/chain/logs";

/**
 * The pipeline's JSON-RPC client per chain: Alchemy through `alchemyTransport`, so every call uses
 * `alchemyRpcUrl(chain)` with the server key and sends the allowlisted Origin. Errors name the chain and the
 * method and never carry the URL (it holds the key).
 */

export const RPC_TIMEOUT_MS = 30_000;
export const RPC_RETRY_COUNT = 2;

/** The provider's own text and the HTTP status of a failed call, redacted, for error messages. */
function detailOf(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof HttpRequestError && error.status) parts.push(`HTTP ${error.status}`);
  if (error instanceof BaseError && error.details) parts.push(error.details);
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "number") parts.push(`code ${code}`);
  return redactSecrets(parts.join("; "));
}

export function rpcClient(chain: RpcChain, options: { timeout?: number; retryCount?: number } = {}): RpcRequester {
  if (!process.env.ALCHEMY_ID) throw new Error("ALCHEMY_ID is not set");
  const client = createPublicClient({
    transport: alchemyTransport(chain, { timeout: options.timeout ?? RPC_TIMEOUT_MS, retryCount: options.retryCount ?? RPC_RETRY_COUNT }),
  });
  return {
    async request({ method, params }) {
      try {
        return await client.request({ method, params } as never);
      } catch (error) {
        const detail = detailOf(error);
        throw new Error(`${chain} ${method}: ${describeError(error)}${detail ? ` (${detail})` : ""}`);
      }
    },
  };
}

/** Unix seconds of a block. */
export async function blockTimestampOf(client: RpcRequester, block: number): Promise<number> {
  const result = (await client.request({ method: "eth_getBlockByNumber", params: [toHex(block), false] })) as { timestamp?: Hex } | null;
  const timestamp = result?.timestamp ? Number.parseInt(result.timestamp, 16) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new Error(`block ${block} has no timestamp`);
  return timestamp;
}
