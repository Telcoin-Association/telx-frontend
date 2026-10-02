import { isRpcChain, type RpcChain } from "./rpc";

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

/** One Uniswap v4 position as the positions route returns it. */
export type Position = {
  tokenId: string;
  isSubscribed: boolean;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amounts: {
    amount0: string;
    amount1: string;
    sqrtPriceX96: string;
  };
  price: {
    price1Per0: number;
    price0Per1: number;
  };
};

/** One registry pool in the positions response. `claimableAmount` is the pool's registry `unclaimedRewards` in wei, or null when that read failed. */
export type PoolPositions = {
  positions: Position[];
  claimableAmount: string | null;
};

/**
 * Body of GET /api/positions: the owner's positions on one chain, keyed by lowercase pool id, with an
 * entry for every Uniswap v4 registry pool on that chain. `blockNumber` is the block the reads were made
 * at. `truncated` is true when the wallet's token list was cut short, so positions may be missing.
 */
export type ChainPositions = {
  chain: RpcChain;
  owner: string;
  blockNumber: number;
  truncated: boolean;
  pools: Record<string, PoolPositions>;
};

/**
 * URL of the owner's positions on `chain`. `minBlock` asks for data read at that block or later, so a
 * refetch after a transfer or a confirmed transaction is not answered from a result read before it.
 */
export function positionsUrl(chain: RpcChain, owner: string, minBlock?: number): string {
  const params = new URLSearchParams({ chain, owner });
  if (minBlock !== undefined) params.set("minBlock", String(minBlock));
  return `/api/positions?${params}`;
}

/**
 * One position's TELx rewards in whole TEL, from Merkl's breakdowns that name its token id. `earned` is everything
 * credited plus what has accrued since Merkl's last update (`pending`); `claimed` is what the wallet has already
 * claimed of it. `unclaimed` is earned and not yet claimed: the part claimable now plus `pending`.
 */
export type PositionTel = { earned: number; claimed: number; pending: number; unclaimed: number };

/**
 * Body of GET /api/positions/rewards: every position's TELx rewards in one wallet on one chain, keyed by token
 * id. A position Merkl has never rewarded has no entry. `priceUSD` is Merkl's TEL price, or null when it has none.
 */
export type WalletPositionRewards = {
  chain: RpcChain;
  owner: string;
  priceUSD: number | null;
  positions: Record<string, PositionTel>;
};

/** URL of a wallet's per-position TELx rewards on `chain`. */
export function positionRewardsUrl(chain: RpcChain, owner: string): string {
  return `/api/positions/rewards?${new URLSearchParams({ chain, owner: owner.toLowerCase() })}`;
}

/** The chain a pool.json `blockchain` value reads positions from. Unknown values fall back to Polygon, as getUniswapChainAddresses does. */
export function positionsChainFor(blockchain?: string | null): RpcChain {
  if (blockchain && isRpcChain(blockchain)) return blockchain;
  // Only a registry chain name that no lookup knows lands here; the registry test keeps pool.json free of them.
  if (blockchain) console.error(`Unknown pool chain "${blockchain}"; reading positions on Polygon`);
  return "polygon";
}
