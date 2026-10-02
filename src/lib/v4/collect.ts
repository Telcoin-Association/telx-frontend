import { formatUnits, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import type { Position } from "@/lib/positions";
import { feeReadCalls, uncollectedFees } from "./fees";
import { collectFeesArgs, erc20Abi, positionManagerAbi, poolKeyId, STATE_VIEW } from "./positionManager";

/*
 * Collecting Uniswap v4 trading fees: what a collect would pay now, read fresh from the chain just before the wallet
 * prompt, and the PositionManager call that pays it. Positions without liquidity are left out, since the PoolManager
 * refuses a zero change on an empty position (CannotUpdateEmptyPosition) and they hold no fees anyway.
 */

/** A position to collect from: its token id, pool and range. */
export type CollectTarget = { tokenId: string; poolId: Hex; tickLower: number; tickUpper: number };

/** True when the position has liquidity and trading fees waiting to be collected. */
export function hasCollectableFees(position: Pick<Position, "liquidity" | "fees">): boolean {
  if (!position.fees || BigInt(position.liquidity || "0") === 0n) return false;
  return Number(position.fees.amount0) > 0 || Number(position.fees.amount1) > 0;
}

/** The collect target for a position in the pool `poolId`. */
export const collectTarget = (position: Pick<Position, "tokenId" | "tickLower" | "tickUpper">, poolId: string): CollectTarget => ({
  tokenId: position.tokenId,
  poolId: poolId.toLowerCase() as Hex,
  tickLower: position.tickLower,
  tickUpper: position.tickUpper,
});

/** One currency a collect pays: its address, symbol, decimals and amount in base units. */
export type CollectAmount = { currency: Address; symbol: string; decimals: number; amount: bigint };

/** A collect ready to send: the positions it covers, what it pays per currency, and the call. */
export type CollectPlan = {
  tokenIds: bigint[];
  amounts: CollectAmount[];
  request: { address: Address; abi: typeof positionManagerAbi; functionName: "modifyLiquidities"; args: [Hex, bigint] };
};

/** The native token's symbol per chain, for the zero-address currency. */
export const NATIVE_SYMBOL: Readonly<Record<number, string>> = { 1: "ETH", 8453: "ETH", 137: "POL" };

/** How long a signed collect stays valid. */
export const COLLECT_DEADLINE_SECONDS = 20 * 60;

type Client = Pick<PublicClient, "multicall">;
type Result = { status: "success"; result: unknown } | { status: "failure"; error?: unknown };

/**
 * What collecting from `targets` would pay `owner` now. Reads each pool's key from the PositionManager and each
 * position's fees from StateView, then each paid token's decimals and symbol. Positions with no liquidity or no
 * fees are left out; null when none is left. Throws when the reads themselves fail.
 */
export async function readCollect(
  client: Client,
  args: { chainId: number; positionManager: Address; owner: Address; targets: readonly CollectTarget[]; nowSeconds?: number },
): Promise<CollectPlan | null> {
  const stateView = STATE_VIEW[args.chainId];
  if (!stateView) throw new Error(`No StateView on chain ${args.chainId}`);
  const poolIds = [...new Set(args.targets.map(target => target.poolId.toLowerCase() as Hex))];

  const first = (await client.multicall({
    allowFailure: true,
    contracts: [
      ...poolIds.map(poolId => ({ address: args.positionManager, abi: positionManagerAbi, functionName: "poolKeys", args: [poolKeyId(poolId)] }) as const),
      ...args.targets.flatMap(target => feeReadCalls(stateView, args.positionManager, target.poolId, target.tokenId, target.tickLower, target.tickUpper)),
    ],
  })) as Result[];

  const keys = new Map<string, [Address, Address]>();
  poolIds.forEach((poolId, i) => {
    const result = first[i];
    if (result?.status !== "success") throw new Error(`Couldn't read the pool ${poolId}`);
    const [currency0, currency1] = result.result as readonly [Address, Address];
    keys.set(poolId, [currency0, currency1]);
  });

  const owed = new Map<string, bigint>();
  const tokenIds: bigint[] = [];
  args.targets.forEach((target, i) => {
    const [info, growth] = first.slice(poolIds.length + i * 2, poolIds.length + i * 2 + 2);
    const fees = uncollectedFees(info, growth);
    if (fees === null) throw new Error(`Couldn't read the fees of position ${target.tokenId}`);
    const liquidity = (info as { result: readonly [bigint] }).result[0];
    if (liquidity === 0n || (fees.amount0 === 0n && fees.amount1 === 0n)) return;
    tokenIds.push(BigInt(target.tokenId));
    const [currency0, currency1] = keys.get(target.poolId.toLowerCase())!;
    owed.set(currency0.toLowerCase(), (owed.get(currency0.toLowerCase()) ?? 0n) + fees.amount0);
    owed.set(currency1.toLowerCase(), (owed.get(currency1.toLowerCase()) ?? 0n) + fees.amount1);
  });
  if (tokenIds.length === 0) return null;

  const currencies = [...owed.keys()] as Address[];
  const tokens = currencies.filter(currency => currency !== zeroAddress);
  const second = (await client.multicall({
    allowFailure: true,
    contracts: tokens.flatMap(token => [
      { address: token, abi: erc20Abi, functionName: "decimals" } as const,
      { address: token, abi: SYMBOL_ABI, functionName: "symbol" } as const,
    ]),
  })) as Result[];
  const meta = new Map<string, { decimals: number; symbol: string }>();
  tokens.forEach((token, i) => {
    const [decimals, symbol] = second.slice(i * 2, i * 2 + 2);
    if (decimals?.status !== "success") throw new Error(`Couldn't read the decimals of ${token}`);
    meta.set(token, { decimals: Number(decimals.result), symbol: symbol?.status === "success" ? String(symbol.result) : "tokens" });
  });

  const amounts: CollectAmount[] = currencies.map(currency => ({
    currency,
    ...(currency === zeroAddress ? { decimals: 18, symbol: NATIVE_SYMBOL[args.chainId] ?? "ETH" } : meta.get(currency)!),
    amount: owed.get(currency)!,
  }));
  const deadline = BigInt((args.nowSeconds ?? Math.floor(Date.now() / 1000)) + COLLECT_DEADLINE_SECONDS);
  return {
    tokenIds,
    amounts,
    request: {
      address: args.positionManager,
      abi: positionManagerAbi,
      functionName: "modifyLiquidities",
      args: collectFeesArgs({ tokenIds, currencies, owner: args.owner, deadline }),
    },
  };
}

const SYMBOL_ABI = [{ type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" }] as const;

const amountFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

/** A collect's amounts in words, for example "0.007123 WETH and 12,830 TEL". Amounts of zero are left out. */
export function describeCollect(amounts: readonly CollectAmount[]): string {
  const parts = amounts.filter(entry => entry.amount > 0n).map(entry => `${amountFormat.format(Number(formatUnits(entry.amount, entry.decimals)))} ${entry.symbol}`);
  if (parts.length === 0) return "nothing";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
