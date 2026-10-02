import "server-only";

import { parseAbi, type Address } from "viem";
import type { RpcChain } from "@/lib/rpc";
import { MERKL_DISTRIBUTOR_ADDRESS } from "@/merkl/merklConstants";
import { positionsChain } from "./chains";
import type { DisputeState } from "./poolRewards";

const DISTRIBUTOR_ABI = parseAbi(["function endOfDisputePeriod() view returns (uint48)", "function disputer() view returns (address)"]);
const CHAIN_BY_ID: Readonly<Record<number, RpcChain>> = { 1: "ethereum", 137: "polygon", 8453: "base" };

/** The Merkl Distributor's dispute state on a chain id: when its current root's dispute window ends, and its disputer. */
export async function readDispute(chainId: number): Promise<DisputeState> {
  const chain = CHAIN_BY_ID[chainId];
  if (!chain) throw new Error(`No client for chain ${chainId}`);
  const { client } = positionsChain(chain);
  const [end, disputer] = await Promise.all([
    client.readContract({ address: MERKL_DISTRIBUTOR_ADDRESS, abi: DISTRIBUTOR_ABI, functionName: "endOfDisputePeriod" }),
    client.readContract({ address: MERKL_DISTRIBUTOR_ADDRESS, abi: DISTRIBUTOR_ABI, functionName: "disputer" }),
  ]);
  return { endOfDisputePeriod: Number(end), disputer: disputer as Address };
}
