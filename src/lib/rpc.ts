/** Chains the browser reads through the same-origin RPC proxy at /api/rpc/[chain]. */
export const RPC_CHAINS = ["ethereum", "polygon", "base"] as const;

export type RpcChain = (typeof RPC_CHAINS)[number];

export function isRpcChain(value: string): value is RpcChain {
  return (RPC_CHAINS as readonly string[]).includes(value);
}

/**
 * Same-origin JSON-RPC endpoint for browser code. The route handler behind it
 * attaches the private Alchemy key, so nothing shipped to the client needs it.
 */
export function rpcProxyUrl(chain: RpcChain): string {
  return `/api/rpc/${chain}`;
}

/**
 * Longest JSON-RPC batch the proxy forwards. It equals ethers' default
 * batchMaxCount, and src/lib/ethersProvider.ts pins the provider to it, so a
 * legitimate batch can never be rejected. Change both together.
 */
export const RPC_MAX_BATCH = 100;
