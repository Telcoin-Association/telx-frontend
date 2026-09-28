/** Chains the browser reads through the same-origin RPC proxy at /api/rpc/[chain]. */
export const RPC_CHAINS = ["ethereum", "polygon", "base"] as const;

export type RpcChain = (typeof RPC_CHAINS)[number];

export function isRpcChain(value: string): value is RpcChain {
  return (RPC_CHAINS as readonly string[]).includes(value);
}

/**
 * Same-origin JSON-RPC endpoint for browser code. The route handler behind it
 * attaches the private Alchemy key, so nothing shipped to the client needs it.
 * The URL is absolute in the browser because ethers' fetch layer refuses any
 * scheme other than http or https and would throw "unsupported protocol
 * /api/rpc/polygon" before sending anything. During server rendering these
 * modules are evaluated but never send a request, so the path alone is enough.
 */
export function rpcProxyUrl(chain: RpcChain): string {
  const path = `/api/rpc/${chain}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

/**
 * Longest JSON-RPC batch the proxy forwards. It equals ethers' default
 * batchMaxCount, and src/lib/ethersProvider.ts pins the provider to it, so a
 * legitimate batch can never be rejected. Change both together.
 */
export const RPC_MAX_BATCH = 100;
