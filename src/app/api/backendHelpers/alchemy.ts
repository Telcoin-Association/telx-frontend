import "server-only";
import { createPublicClient, http, type HttpTransportConfig } from "viem";
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

/** Alchemy NFT API v3 endpoint for `chain`, e.g. getNFTsForOwner. Server-only like the RPC URL. */
export function alchemyNftUrl(chain: RpcChain, method: string): string {
  return `https://${ALCHEMY_HOSTS[chain]}.g.alchemy.com/nft/v3/${process.env.ALCHEMY_ID}/${method}`;
}

/**
 * Origin header sent on server-side Alchemy calls so they pass the key's allowed-origin list:
 * NEXT_PUBLIC_ORIGIN when set; on Vercel, the production domain for production deployments and the
 * deployment's own host otherwise; localhost only outside Vercel.
 */
export function siteOrigin(): string {
  if (process.env.NEXT_PUBLIC_ORIGIN) return process.env.NEXT_PUBLIC_ORIGIN;
  const host =
    process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000/";
}

/** viem transport to Alchemy for `chain`, sending the allowlisted Origin. `config` adds options such as timeout and retries. */
export function alchemyTransport(chain: RpcChain, config: Omit<HttpTransportConfig, "fetchOptions"> = {}) {
  return http(alchemyRpcUrl(chain), { ...config, fetchOptions: { headers: { Origin: siteOrigin() } } });
}

/**
 * viem public clients for route handlers. They talk to Alchemy directly.
 * Browser code uses the proxy-backed clients in src/lib/publicClients.ts.
 */
export const publicClientEthereum = createPublicClient({ chain: mainnet, transport: alchemyTransport("ethereum") });
export const publicClientPolygon = createPublicClient({ chain: polygon, transport: alchemyTransport("polygon") });
export const publicClientBase = createPublicClient({ chain: base, transport: alchemyTransport("base") });
