import "server-only";

import type { Address } from "viem";

import type { RpcChain } from "@/lib/rpc";

/**
 * Per-chain configuration of the Uniswap v4 RPC pipeline: contracts, Chainlink feeds and the tokens of the
 * registry's active pools with the rule that prices each. Addresses are from the Uniswap v4 deployments page
 * and Chainlink's feed list; the registry tests check every pool currency against `tokens`.
 */

export type FeedName = "ETH/USD" | "MXN/USD";

export type FeedConfig = {
  address: Address;
  decimals: number;
  /**
   * Longest time between rounds. An answer older than this plus FEED_GRACE_SECONDS is stale. Set from the
   * gaps between the feed's recent rounds on 2026-09-29.
   */
  heartbeatSeconds: number;
};

/** How a token is priced in USD. */
export type PriceRule = { kind: "feed"; feed: FeedName } | { kind: "fixedUsd"; usd: number } | { kind: "fromPools" };

export type TokenConfig = { symbol: string; decimals: number; price: PriceRule };

export type ChainConfig = {
  chain: RpcChain;
  chainId: number;
  /** Seconds per block, for sizing chunks and for timing a log that arrives without `blockTimestamp`. */
  blockTime: number;
  /** Most blocks one run reads: 12 hours of blocks. */
  maxBlocksPerChunk: number;
  /** Blocks per backfill chunk: one hour. Each chunk is priced at its end block. */
  backfillChunkBlocks: number;
  /**
   * The block the cron reads up to. `finalized` never changes once read. `safe` trails the head by about a
   * minute on Base (its batch is on Ethereum) and about 13 minutes on Ethereum (a justified checkpoint), where
   * `finalized` trails by 15 to 45 minutes on Base, moving in jumps as Ethereum finalizes Base's batches. A
   * safe block changes only if Ethereum reorganizes before finalizing, and nothing here rewinds for that: such
   * a block's events stay in the day and 5-minute totals. Polygon has no `safe` block, and its finalized block
   * trails by seconds.
   */
  headTag: "safe" | "finalized";
  /** Past this lag behind the head tag's block, the 24h values are withheld and health reports the chain as lagging. */
  lagLimitSeconds: number;
  geckoTerminalNetwork: string;
  contracts: { poolManager: Address; stateView: Address; reservesLens: Address; multicall3: Address };
  feeds: Partial<Record<FeedName, FeedConfig>>;
  /** Keyed by lowercase address; native ETH is the zero address. */
  tokens: Record<string, TokenConfig>;
};

/** Extra time allowed past a feed's heartbeat before its answer counts as stale. */
export const FEED_GRACE_SECONDS = 600;

export const NATIVE = "0x0000000000000000000000000000000000000000";
export const TEL = "0x7e13b43065380acdec1c2d138c579cbbbafa0731";
const EUSD = "0x14913815bcfde78baead2111f463d038ac9c2949";

const RESERVES_LENS: Address = "0x0000001b173C3bbF3984D417d8614E3eed34865B";
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const TEL_TOKEN: TokenConfig = { symbol: "TEL", decimals: 18, price: { kind: "fromPools" } };
const EUSD_TOKEN: TokenConfig = { symbol: "eUSD", decimals: 6, price: { kind: "fixedUsd", usd: 1 } };
const ETH_TOKEN: TokenConfig = { symbol: "ETH", decimals: 18, price: { kind: "feed", feed: "ETH/USD" } };

export const CHAINS: Record<RpcChain, ChainConfig> = {
  polygon: {
    chain: "polygon",
    headTag: "finalized",
    chainId: 137,
    blockTime: 1.5,
    maxBlocksPerChunk: 28_800,
    backfillChunkBlocks: 2_400,
    lagLimitSeconds: 600,
    geckoTerminalNetwork: "polygon_pos",
    contracts: {
      poolManager: "0x67366782805870060151383f4bbff9dab53e5cd6",
      stateView: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
      reservesLens: RESERVES_LENS,
      multicall3: MULTICALL3,
    },
    feeds: {
      "ETH/USD": { address: "0xF9680D99D6C9589e2a93a78A04A279e509205945", decimals: 8, heartbeatSeconds: 60 },
      "MXN/USD": { address: "0x171b16562EA3476F5C61d1b8dad031DbA0768545", decimals: 8, heartbeatSeconds: 86_400 },
    },
    tokens: {
      "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": { symbol: "WETH", decimals: 18, price: { kind: "feed", feed: "ETH/USD" } },
      [TEL]: TEL_TOKEN,
      [EUSD]: EUSD_TOKEN,
      "0x68727e573d21a49c767c3c86a92d9f24bd933c99": { symbol: "eMXN", decimals: 6, price: { kind: "feed", feed: "MXN/USD" } },
    },
  },
  base: {
    chain: "base",
    headTag: "safe",
    chainId: 8453,
    blockTime: 2,
    maxBlocksPerChunk: 21_600,
    backfillChunkBlocks: 1_800,
    lagLimitSeconds: 3_600,
    geckoTerminalNetwork: "base",
    contracts: {
      poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
      stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
      reservesLens: RESERVES_LENS,
      multicall3: MULTICALL3,
    },
    feeds: {
      "ETH/USD": { address: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8, heartbeatSeconds: 1_200 },
    },
    tokens: { [NATIVE]: ETH_TOKEN, [TEL]: TEL_TOKEN, [EUSD]: EUSD_TOKEN },
  },
  ethereum: {
    chain: "ethereum",
    headTag: "safe",
    chainId: 1,
    blockTime: 12,
    maxBlocksPerChunk: 3_600,
    backfillChunkBlocks: 300,
    lagLimitSeconds: 2_700,
    geckoTerminalNetwork: "eth",
    contracts: {
      poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
      reservesLens: RESERVES_LENS,
      multicall3: MULTICALL3,
    },
    feeds: {
      "ETH/USD": { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", decimals: 8, heartbeatSeconds: 3_600 },
    },
    tokens: { [NATIVE]: ETH_TOKEN, [TEL]: TEL_TOKEN, [EUSD]: EUSD_TOKEN },
  },
};
