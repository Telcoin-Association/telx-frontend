import { JsonRpcProvider } from "ethers";
import { RPC_MAX_BATCH, rpcProxyUrl } from "./rpc";

/**
 * Read-only Polygon provider for the ethers-based contract helpers under src/web3.
 * It reads through the same-origin RPC proxy, so the browser never needs an
 * Alchemy key. The network is pinned so ethers skips the eth_chainId round trip.
 * Batches are capped at RPC_MAX_BATCH, the longest batch the proxy forwards.
 */
export const provider = new JsonRpcProvider(rpcProxyUrl("polygon"), 137, { staticNetwork: true, batchMaxCount: RPC_MAX_BATCH });
