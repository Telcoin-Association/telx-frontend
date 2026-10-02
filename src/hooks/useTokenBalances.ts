import { useEffect, useState } from "react";
import { erc20Abi } from "viem";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "@/lib/publicClients";
import type { RpcChain } from "@/lib/rpc";

const CLIENTS = { ethereum: publicClientEthereum, polygon: publicClientPolygon, base: publicClientBase } as const;

export type TokenBalances = { balances: Partial<Record<RpcChain, bigint>>; loading: boolean };

/**
 * The `owner`'s balance of one token per chain (`tokens` maps a chain to the token's address there), read through
 * the proxy-backed public clients: one `balanceOf` per chain. Nothing is read without an owner. A chain whose read
 * fails is left out, so callers treat it as unknown rather than as zero.
 */
export function useTokenBalances(owner: `0x${string}` | undefined, tokens: Partial<Record<RpcChain, `0x${string}`>>): TokenBalances {
  const [state, setState] = useState<TokenBalances>({ balances: {}, loading: false });
  // The token map is a module constant at every call site; its contents key the effect.
  const key = Object.entries(tokens)
    .map(([chain, address]) => `${chain}:${address}`)
    .join(",");

  useEffect(() => {
    if (!owner) {
      setState({ balances: {}, loading: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    const entries = Object.entries(tokens) as [RpcChain, `0x${string}`][];
    Promise.allSettled(
      entries.map(([chain, address]) => CLIENTS[chain].readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [owner] })),
    ).then((results) => {
      if (cancelled) return;
      const balances: Partial<Record<RpcChain, bigint>> = {};
      results.forEach((result, i) => {
        if (result.status === "fulfilled") balances[entries[i][0]] = result.value;
      });
      setState({ balances, loading: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, key]);

  return state;
}
