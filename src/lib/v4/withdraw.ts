import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { getAmount0ForLiquidity, getAmount1ForLiquidity, getAmountsForLiquidity, getSqrtPriceAtTick } from "./liquidityMath";
import { slippageSqrtPrices } from "./deposit";
import { erc20Abi, isNative, positionManagerAbi, STATE_VIEW, stateViewAbi, type PoolKey } from "./positionManager";
import type { TickRange } from "./range";

/**
 * Removing liquidity from a Uniswap v4 position, in part or all of it, and closing the position: how much liquidity a
 * percentage removes, what it pays out, the least it may pay out while the price stays within the slippage, and the
 * position's state read fresh from the chain just before the wallet prompt. Amounts are raw token units.
 */

/** The percentages offered for a removal. 100 removes everything, which closes the position. */
export const WITHDRAW_PERCENTS = [25, 50, 75, 100] as const;

/** The liquidity `percent` of `liquidity` removes: all of it at 100, and rounded down below that. */
export function liquidityForPercent(liquidity: bigint, percent: number): bigint {
  const whole = Math.min(100, Math.max(0, Math.round(percent)));
  return whole === 100 ? liquidity : (liquidity * BigInt(whole)) / 100n;
}

const clamp = (value: bigint, low: bigint, high: bigint) => (value < low ? low : value > high ? high : value);
const smaller = (a: bigint, b: bigint) => (a < b ? a : b);

export type WithdrawAmounts = { amount0: bigint; amount1: bigint; amount0Min: bigint; amount1Min: bigint };

/**
 * What removing `liquidity` from `range` pays out at `sqrtPriceX96`, and the least it may pay out while the pool price
 * stays within `slippageBps` of it: the mirror of maxAmountsForLiquidity and the bound Uniswap's SDK puts on a
 * removal (`burnAmountsWithSlippage`). Token0 is what the liquidity holds at the highest price of the band, token1
 * what it holds at the lowest. The band is clamped to the range, amounts round down as the PoolManager pays them,
 * and neither minimum is above what the removal pays at `sqrtPriceX96`.
 *
 * The bound is on the price rather than on the amounts: near the edge of a narrow range a small price move shifts the
 * token mix by many times its own size, so a percentage off each amount would not cover it.
 */
export function minAmountsForLiquidity(range: TickRange, sqrtPriceX96: bigint, liquidity: bigint, slippageBps: number): WithdrawAmounts {
  const sqrtA = getSqrtPriceAtTick(range.tickLower);
  const sqrtB = getSqrtPriceAtTick(range.tickUpper);
  const paid = getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity, false);
  const band = slippageSqrtPrices(sqrtPriceX96, slippageBps);
  return {
    amount0: paid.amount0,
    amount1: paid.amount1,
    amount0Min: smaller(getAmount0ForLiquidity(clamp(band.upper, sqrtA, sqrtB), sqrtB, liquidity, false), paid.amount0),
    amount1Min: smaller(getAmount1ForLiquidity(sqrtA, clamp(band.lower, sqrtA, sqrtB), liquidity, false), paid.amount1),
  };
}

export type WithdrawPlan = WithdrawAmounts & { percent: number; liquidity: bigint; closes: boolean };

/** Removing `percent` of a position holding `positionLiquidity`: the liquidity, its payout and minimums, and whether it closes the position. Null when it removes nothing. */
export function planWithdraw(
  range: TickRange,
  sqrtPriceX96: bigint,
  positionLiquidity: bigint,
  percent: number,
  slippageBps: number,
): WithdrawPlan | null {
  const liquidity = liquidityForPercent(positionLiquidity, percent);
  if (liquidity <= 0n) return null;
  return { percent, liquidity, closes: liquidity === positionLiquidity, ...minAmountsForLiquidity(range, sqrtPriceX96, liquidity, slippageBps) };
}

/**
 * How a close is sent for a position with `subscriber` (the zero address when it has none): a subscribed position is
 * unsubscribed in the same multicall before the burn (see closePositionCall), an unsubscribed one is burned directly.
 */
export type CloseFlow = "burn" | "unsubscribeAndBurn";
export const closeFlow = (subscriber: Address): CloseFlow => (subscriber.toLowerCase() === zeroAddress ? "burn" : "unsubscribeAndBurn");

/** A position as the chain holds it now, with its pool's price: what a removal or an increase is planned against. */
export type PositionState = {
  tokenId: bigint;
  owner: Address;
  poolKey: PoolKey;
  range: TickRange;
  liquidity: bigint;
  subscriber: Address;
  sqrtPriceX96: bigint;
  tick: number;
  decimals: [number, number];
};

const signed24 = (raw: bigint): number => {
  const value = Number(raw & 0xffffffn);
  return value >= 0x800000 ? value - 0x1000000 : value;
};

/** The ticks in a PositionManager PositionInfo word: tickLower in bits 8-31, tickUpper in bits 32-55. */
export const positionInfoRange = (info: bigint): TickRange => ({ tickLower: signed24(info >> 8n), tickUpper: signed24(info >> 32n) });

const ownerOfAbi = [
  { type: "function", name: "ownerOf", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

type Client = Pick<PublicClient, "readContract">;

/**
 * Reads position `tokenId` from the PositionManager (its owner, pool, range, liquidity and subscriber), its pool's
 * price from StateView, and both tokens' decimals. `poolId` is the pool's full id, which StateView keys pools by.
 * Throws when a read fails, including for a burned position, whose `ownerOf` reverts.
 */
export async function readPositionState(
  client: Client,
  args: { chainId: number; positionManager: Address; poolId: Hex; tokenId: bigint },
): Promise<PositionState> {
  const stateView = STATE_VIEW[args.chainId];
  if (!stateView) throw new Error(`No StateView on chain ${args.chainId}`);
  const at = { address: args.positionManager, abi: positionManagerAbi } as const;
  const [owner, [poolKey, info], liquidity, subscriber, slot0] = await Promise.all([
    client.readContract({ address: args.positionManager, abi: ownerOfAbi, functionName: "ownerOf", args: [args.tokenId] }),
    client.readContract({ ...at, functionName: "getPoolAndPositionInfo", args: [args.tokenId] }),
    client.readContract({ ...at, functionName: "getPositionLiquidity", args: [args.tokenId] }),
    client.readContract({ ...at, functionName: "subscriber", args: [args.tokenId] }),
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getSlot0", args: [args.poolId] }),
  ]);
  const decimalsOf = (currency: Address) =>
    isNative(currency) ? Promise.resolve(18) : client.readContract({ address: currency, abi: erc20Abi, functionName: "decimals" });
  const decimals = await Promise.all([decimalsOf(poolKey.currency0), decimalsOf(poolKey.currency1)]);
  return {
    tokenId: args.tokenId,
    owner,
    poolKey: { ...poolKey },
    range: positionInfoRange(info),
    liquidity,
    subscriber,
    sqrtPriceX96: slot0[0],
    tick: slot0[1],
    decimals: [Number(decimals[0]), Number(decimals[1])],
  };
}
