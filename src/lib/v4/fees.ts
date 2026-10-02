import { pad, parseAbi, toHex, type Address, type Hex } from "viem";

/**
 * A Uniswap v4 position's uncollected fees, read from the pool through StateView. The PoolManager tracks each
 * position's fee growth inside its range as of its last liquidity change (`feeGrowthInside*LastX128`); what it is
 * owed now is the growth since, times its liquidity, over 2^128. Growth counters wrap modulo 2^256 by design.
 * The PositionManager owns every position in the PoolManager, keyed by the token id as the salt.
 */

export const stateViewFeeAbi = parseAbi([
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)",
]);

const Q128 = 2n ** 128n;
const TWO_256 = 2n ** 256n;

/** Fees owed for one currency, in base units: (inside − last) mod 2^256 × liquidity / 2^128. */
export function owedFee(liquidity: bigint, insideX128: bigint, lastX128: bigint): bigint {
  const growth = (((insideX128 - lastX128) % TWO_256) + TWO_256) % TWO_256;
  return (growth * liquidity) / Q128;
}

/** The salt the PositionManager uses for a token id in the PoolManager. */
export const positionSalt = (tokenId: bigint | string): Hex => pad(toHex(BigInt(tokenId)), { size: 32 });

/** The two StateView reads that give a position's uncollected fees, in the order `uncollectedFees` expects. */
export function feeReadCalls(stateView: Address, positionManager: Address, poolId: Hex, tokenId: bigint | string, tickLower: number, tickUpper: number) {
  return [
    { address: stateView, abi: stateViewFeeAbi, functionName: "getPositionInfo", args: [poolId, positionManager, tickLower, tickUpper, positionSalt(tokenId)] },
    { address: stateView, abi: stateViewFeeAbi, functionName: "getFeeGrowthInside", args: [poolId, tickLower, tickUpper] },
  ] as const;
}

type ReadResult = { status: "success"; result: unknown } | { status: "failure"; error?: unknown } | undefined;

/** Uncollected fees in base units from the results of `feeReadCalls`, or null when either read failed. */
export function uncollectedFees(positionInfo: ReadResult, feeGrowth: ReadResult): { amount0: bigint; amount1: bigint } | null {
  if (positionInfo?.status !== "success" || feeGrowth?.status !== "success") return null;
  const [liquidity, last0, last1] = positionInfo.result as readonly [bigint, bigint, bigint];
  const [inside0, inside1] = feeGrowth.result as readonly [bigint, bigint];
  return { amount0: owedFee(liquidity, inside0, last0), amount1: owedFee(liquidity, inside1, last1) };
}
