import { createPublicClient, http } from "viem";
import { base, mainnet, polygon } from "viem/chains";
import { rpcProxyUrl } from "./rpc";

/**
 * viem public clients for browser code. They read through the same-origin RPC
 * proxy. Route handlers use the clients in src/app/api/backendHelpers/alchemy.ts,
 * which talk to Alchemy directly with the private key.
 */
export const publicClientEthereum = createPublicClient({
  chain: mainnet,
  transport: http(rpcProxyUrl("ethereum")),
});

export const publicClientPolygon = createPublicClient({
  chain: polygon,
  transport: http(rpcProxyUrl("polygon")),
});

export const publicClientBase = createPublicClient({
  chain: base,
  transport: http(rpcProxyUrl("base")),
});
