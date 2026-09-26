import "server-only";
import { createPublicClient, http } from "viem";
import { base, mainnet, polygon } from "viem/chains";
import type { RpcChain } from "@/lib/rpc";

const ALCHEMY_HOSTS: Record<RpcChain, string> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  base: "base-mainnet",
};

/**
 * Alchemy JSON-RPC endpoint for `chain` with the private key attached.
 * Server-only: the `server-only` import makes the build fail if a client
 * module ever pulls this in. Browser code goes through /api/rpc/[chain].
 */
export function alchemyRpcUrl(chain: RpcChain): string {
  return `https://${ALCHEMY_HOSTS[chain]}.g.alchemy.com/v2/${process.env.ALCHEMY_ID}`;
}

/** Origin header sent on server-side Alchemy calls so they pass the app's allowed-origin list. */
export function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_ORIGIN || "http://localhost:3000/";
}

function alchemyTransport(chain: RpcChain) {
  return http(alchemyRpcUrl(chain), { fetchOptions: { headers: { Origin: siteOrigin() } } });
}

/**
 * viem public clients for route handlers. They talk to Alchemy directly.
 * Browser code uses the proxy-backed clients in src/lib/publicClients.ts.
 */
export const publicClientEthereum = createPublicClient({ chain: mainnet, transport: alchemyTransport("ethereum") });
export const publicClientPolygon = createPublicClient({ chain: polygon, transport: alchemyTransport("polygon") });
export const publicClientBase = createPublicClient({ chain: base, transport: alchemyTransport("base") });
