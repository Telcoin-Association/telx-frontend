import { useEffect, useRef } from "react";
import { BLOCK_TIME_MS, transferFeedUrl, type TransferFeed } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";

/** Longest pause between polls after repeated feed failures. */
export const MAX_POLL_BACKOFF_MS = 30_000;

/**
 * The block to refetch the owner's positions at after reading `feed`, or null when nothing changed for them.
 *
 * `lastSeen` is the newest head already processed for this chain, or undefined before the first read.
 * Transfers to or from the owner newer than `lastSeen` count; on the first read every transfer in the
 * window counts, since the page may have loaded its positions just before one of them. When the feed
 * starts after `lastSeen` (the page was hidden for longer than the window), transfers may have been missed,
 * so the answer is the head.
 */
export function transferRefetchBlock(feed: TransferFeed, owner: string, lastSeen: number | undefined): number | null {
  if (lastSeen !== undefined && feed.fromBlock > lastSeen + 1) return feed.head;
  const account = owner.toLowerCase();
  let block: number | null = null;
  for (const transfer of feed.transfers) {
    if (lastSeen !== undefined && transfer.blockNumber <= lastSeen) continue;
    if (transfer.to === account || transfer.from === account) block = Math.max(block ?? 0, transfer.blockNumber);
  }
  return block;
}

export type PositionTransferWatchOptions = {
  /** The connected wallet. Nothing is polled without one. */
  owner?: string;
  /** Chains to watch. Order and duplicates do not matter. */
  chains: readonly RpcChain[];
  enabled?: boolean;
  /** Called when a PositionManager transfer to or from `owner` lands, with the chain and the block to refetch at. */
  onTransfer: (chain: RpcChain, blockNumber: number) => void;
  fetchImpl?: typeof fetch;
};

/**
 * Watches the shared transfer feed (/api/positions/transfers) for a mint to, or a transfer from, the
 * connected wallet, and calls `onTransfer` so the page can refetch that chain's positions.
 *
 * While the page is visible each chain's feed is polled about once per block. It is polled at once when
 * the page becomes visible or the window gains focus, which is when someone returns from Uniswap, and not
 * at all while the page is hidden. The feed is cached at the edge, so a poll rarely reaches the chain.
 * After a failed poll the interval doubles, up to MAX_POLL_BACKOFF_MS.
 */
export function usePositionTransferWatch({ owner, chains, enabled = true, onTransfer, fetchImpl }: PositionTransferWatchOptions) {
  const onTransferRef = useRef(onTransfer);
  useEffect(() => {
    onTransferRef.current = onTransfer;
  }, [onTransfer]);

  const chainsKey = [...new Set(chains)].sort().join(",");

  useEffect(() => {
    if (!enabled || !owner || !chainsKey) return;
    const watched = chainsKey.split(",") as RpcChain[];
    const request = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const controller = new AbortController();
    const lastSeen = new Map<RpcChain, number>();
    const failures = new Map<RpcChain, number>();
    const timers = new Map<RpcChain, ReturnType<typeof setTimeout>>();
    const inFlight = new Set<RpcChain>();
    let stopped = false;

    const isVisible = () => document.visibilityState === "visible";

    const cancel = (chain: RpcChain) => {
      clearTimeout(timers.get(chain));
      timers.delete(chain);
    };

    const schedule = (chain: RpcChain, startedAt: number) => {
      cancel(chain);
      if (stopped || !isVisible()) return;
      const interval = Math.min(BLOCK_TIME_MS[chain] * 2 ** (failures.get(chain) ?? 0), MAX_POLL_BACKOFF_MS);
      const delay = Math.max(0, interval - (Date.now() - startedAt));
      timers.set(
        chain,
        setTimeout(() => void poll(chain), delay),
      );
    };

    async function poll(chain: RpcChain) {
      if (stopped || inFlight.has(chain)) return;
      cancel(chain);
      inFlight.add(chain);
      const startedAt = Date.now();
      try {
        const res = await request(transferFeedUrl(chain), { signal: controller.signal });
        if (!res.ok) throw new Error(`Transfer feed responded ${res.status}`);
        const feed = (await res.json()) as TransferFeed;
        failures.delete(chain);
        if (stopped || !owner) return;
        const previous = lastSeen.get(chain);
        const block = transferRefetchBlock(feed, owner, previous);
        lastSeen.set(chain, Math.max(previous ?? 0, feed.head));
        if (block !== null) onTransferRef.current(chain, block);
      } catch {
        if (!stopped) failures.set(chain, Math.min((failures.get(chain) ?? 0) + 1, 8));
      } finally {
        inFlight.delete(chain);
        schedule(chain, startedAt);
      }
    }

    const pollAll = () => {
      if (isVisible()) watched.forEach(chain => void poll(chain));
    };
    const onVisibilityChange = () => {
      if (isVisible()) pollAll();
      else watched.forEach(cancel);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", pollAll);
    pollAll();

    return () => {
      stopped = true;
      controller.abort();
      watched.forEach(cancel);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", pollAll);
    };
  }, [enabled, owner, chainsKey, fetchImpl]);
}
