import type { RpcChain } from "@/lib/rpc";

/**
 * Body of GET /api/admin/wallet: what happened to one wallet's TELx positions on every chain, for answering
 * support questions. Times are unix seconds.
 */

export const ADMIN_WALLET_CHAINS: readonly RpcChain[] = ["polygon", "base", "ethereum"];

/** Headers on the report: never cached by the CDN or a browser, never indexed. */
export const WALLET_DIAGNOSTICS_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

export const EXPLORER_URLS: Readonly<Record<RpcChain, string>> = {
  polygon: "https://polygonscan.com",
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
};

/**
 * How a subscription ended:
 * - `owner`: the holder unsubscribed through the PositionManager;
 * - `burned`: the position was burned;
 * - `transferred`: the position moved to another wallet;
 * - `registry`: the registry removed it on its own (pruned or force-unsubscribed);
 * - `unknown`: the transaction could not be read.
 */
export type UnsubscribeHow = "owner" | "burned" | "transferred" | "registry" | "unknown";

export type AdminSubscriptionEvent = {
  kind: "subscribed" | "unsubscribed";
  t: number;
  block: number;
  txHash: string;
  how: UnsubscribeHow | null;
};

export type AdminRangeSpan = { from: number; to: number; inRange: boolean | null; subscribed: boolean };

export type AdminRangeTimeline = {
  from: number;
  to: number;
  activeSeconds: number;
  inRangeSeconds: number;
  outOfRangeSeconds: number;
  unknownSeconds: number;
  subscribedSeconds: number;
  subscribedOutOfRangeSeconds: number;
  spans: AdminRangeSpan[];
  spansTruncated: boolean;
};

/**
 * - `open`: held, with liquidity;
 * - `empty`: held, with all liquidity removed;
 * - `burned`: burned by this wallet;
 * - `transferred`: sent to another wallet;
 * - `unknown`: seen in the registry's events but neither held nor sent away in the scanned blocks.
 */
export type AdminPositionStatus = "open" | "empty" | "burned" | "transferred" | "unknown";

export type AdminPosition = {
  chain: RpcChain;
  tokenId: string;
  poolId: string | null;
  poolName: string | null;
  /** A pool in the Merkl TELx program, rewarded through the Merkl registry. */
  merklPool: boolean;
  status: AdminPositionStatus;
  tickLower: number | null;
  tickUpper: number | null;
  liquidity: string;
  /** Current token amounts, for positions the wallet holds. */
  amounts: { amount0: string; amount1: string; symbol0: string; symbol1: string } | null;
  currentTick: number | null;
  inRangeNow: boolean | null;
  subscribed: boolean | null;
  /** The Merkl registry's own view of the position, for Merkl pool positions that still exist. */
  registry: { isInRange: boolean | null; belowThreshold: boolean | null; eligible: boolean | null } | null;
  subscriptions: AdminSubscriptionEvent[];
  range: AdminRangeTimeline | null;
  positionUrl: string;
};

export type AdminMerklReward = {
  symbol: string;
  amount: string;
  claimed: string;
  claimable: string;
  pending: string;
  claimableUSD: number | null;
};

export type AdminChainReport = {
  chain: RpcChain;
  head: { block: number; timestamp: number } | null;
  /** Whether the Merkl registry requires positions in range, or null when it could not be read. */
  inRangeRequired: boolean | null;
  positions: AdminPosition[];
  /** Merkl rewards per token, or null when Merkl could not be read. */
  merkl: AdminMerklReward[] | null;
  /** Old pools claimable TEL on Base and Polygon; undefined on chains without old pools rewards; null when unreadable. */
  oldPoolsClaimable?: string | null;
  notes: string[];
  errors: string[];
};

export type AdminFlagKind =
  | "subscribed-out-of-range"
  | "out-of-range"
  | "not-subscribed"
  | "not-eligible"
  | "below-threshold"
  | "removed-by-registry"
  | "empty-still-subscribed"
  | "old-program-pool"
  | "mostly-out-of-range";

export type AdminFlag = { kind: AdminFlagKind; chain: RpcChain; tokenId: string; message: string };

export type AdminWalletReport = {
  address: string;
  generatedAt: number;
  chains: AdminChainReport[];
  flags: AdminFlag[];
};

export const explorerTxUrl = (chain: RpcChain, hash: string) => `${EXPLORER_URLS[chain]}/tx/${hash}`;
