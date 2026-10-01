"use client";

import React from "react";
import { useAccount } from "wagmi";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useNow } from "@/hooks/useNow";
import { getMerklRewards } from "@/helpers/poolRewardsDisplay";
import { TEL_TOKEN_ADDRESS } from "@/merkl/merklConstants";
import { chainDisplayName } from "@/lib/poolTitle";
import { isRpcChain, RPC_CHAINS, type RpcChain } from "@/lib/rpc";
import { TEL_BRIDGE_URL, TEL_UPGRADE_HOST } from "@/lib/tokens";

/** TEL3 has one address on every supported chain. */
const TEL3_BY_CHAIN: Record<RpcChain, `0x${string}`> = { ethereum: TEL_TOKEN_ADDRESS, polygon: TEL_TOKEN_ADDRESS, base: TEL_TOKEN_ADDRESS };

/** The pool fields the note reads: its protocol and chain, and the Merkl fields getMerklRewards reads. */
type PoolForBridge = { protocol?: string | null; blockchain?: string | null } & Record<string, unknown>;

/**
 * On a Uniswap pool page with a live or scheduled campaign, points a wallet that holds no TEL3 on the pool's chain,
 * but holds some on another supported chain, to the official bridge. Unknown balances (a failed read) never show it.
 */
export default function BridgeTelNote({ pool }: { pool: PoolForBridge }) {
  const { address } = useAccount();
  const now = useNow();
  const chain = pool.blockchain && isRpcChain(pool.blockchain) ? pool.blockchain : null;
  const status = getMerklRewards(pool, now).status;
  const relevant = pool.protocol === "uniswap" && chain !== null && (status === "LIVE" || status === "SOON");
  const { balances } = useTokenBalances(relevant ? address : undefined, TEL3_BY_CHAIN);

  if (!relevant || !chain || balances[chain] !== 0n) return null;
  const elsewhere = RPC_CHAINS.filter((other) => other !== chain && (balances[other] ?? 0n) > 0n);
  if (elsewhere.length === 0) return null;

  const target = chainDisplayName(chain);
  return (
    <p className="mx-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white xl:mx-0">
      This pool is on {target}, and your TEL3 is on {elsewhere.map(chainDisplayName).join(" and ")}.{" "}
      <a href={TEL_BRIDGE_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline underline-offset-4 hover:text-white">
        Bridge TEL3 to {target}
      </a>{" "}
      <span className="text-xs text-primary">on {TEL_UPGRADE_HOST}</span>
    </p>
  );
}
