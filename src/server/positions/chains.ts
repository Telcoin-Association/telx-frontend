import "server-only";
import type { Address, Chain, PublicClient, Transport } from "viem";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "@/app/api/backendHelpers/alchemy";
import { BASE_POSITION_MANAGER, ETHEREUM_POSITION_MANAGER, POLYGON_POSITION_MANAGER } from "@/lib/contracts";
import type { RpcChain } from "@/lib/rpc";

export type PositionsClient = PublicClient<Transport, Chain>;

/** The server-side client and the Uniswap v4 PositionManager for one chain. */
export type PositionsChain = {
  chain: RpcChain;
  client: PositionsClient;
  positionManager: Address;
};

const CHAINS: Record<RpcChain, () => PositionsChain> = {
  polygon: () => ({ chain: "polygon", client: publicClientPolygon as PositionsClient, positionManager: POLYGON_POSITION_MANAGER }),
  base: () => ({ chain: "base", client: publicClientBase as PositionsClient, positionManager: BASE_POSITION_MANAGER }),
  ethereum: () => ({ chain: "ethereum", client: publicClientEthereum as PositionsClient, positionManager: ETHEREUM_POSITION_MANAGER }),
};

export function positionsChain(chain: RpcChain): PositionsChain {
  return CHAINS[chain]();
}
