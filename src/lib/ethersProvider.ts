import { JsonRpcProvider } from "ethers";
import { rpcProxyUrl } from "./rpc";

/**
 * Read-only Polygon provider for the ethers-based contract helpers under src/web3.
 * It reads through the same-origin RPC proxy, so the browser never needs an
 * Alchemy key. The network is pinned so ethers skips the eth_chainId round trip.
 */
export const provider = new JsonRpcProvider(rpcProxyUrl("polygon"), 137, { staticNetwork: true });
