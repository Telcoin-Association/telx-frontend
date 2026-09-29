import type { RpcChain } from "./rpc";

/**
 * Shapes and timing shared by the positions API routes and the browser code that polls them. Nothing here
 * touches a key or an upstream, so both sides import it.
 */

/** Typical block interval per chain. The transfer feed is cached at the edge for about one block and polled once per block. */
export const BLOCK_TIME_MS: Readonly<Record<RpcChain, number>> = {
  polygon: 2_000,
  base: 2_000,
  ethereum: 12_000,
};

/**
 * Blocks of PositionManager transfers the feed returns, ending at the head: about ten minutes on every
 * chain. The positions route merges the same window into Alchemy's token list, so the window also has to
 * outlast Alchemy's index lag, which has been seen at several minutes.
 */
export const TRANSFER_WINDOW_BLOCKS: Readonly<Record<RpcChain, number>> = {
  polygon: 300,
  base: 300,
  ethereum: 50,
};

/** One PositionManager `Transfer`. Addresses are lowercase; a mint has the zero address as `from`, a burn as `to`. */
export type PositionTransfer = {
  tokenId: string;
  from: string;
  to: string;
  blockNumber: number;
  logIndex: number;
};

/** Body of GET /api/positions/transfers: every transfer in blocks `fromBlock` to `head`, oldest first. */
export type TransferFeed = {
  chain: RpcChain;
  head: number;
  fromBlock: number;
  transfers: PositionTransfer[];
};

/** Canonical URL of a chain's transfer feed. Every visitor uses this exact URL, so they share one edge cache entry. */
export function transferFeedUrl(chain: RpcChain): string {
  return `/api/positions/transfers?chain=${chain}`;
}
