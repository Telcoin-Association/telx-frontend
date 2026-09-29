import "server-only";

import { parseAbi, toEventSelector } from "viem";

/** The contract interfaces the Uniswap v4 RPC pipeline calls. */

export const POOL_MANAGER_EVENTS = parseAbi([
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);

export const MODIFY_LIQUIDITY_TOPIC = toEventSelector(POOL_MANAGER_EVENTS[0]);
export const SWAP_TOPIC = toEventSelector(POOL_MANAGER_EVENTS[1]);

export const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

/** ReservesLens.getPoolTVL: the pool's core token amounts (principal in the PoolManager) at the call's block. */
export const RESERVES_LENS_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct PoolTVL { uint256 coreAmount0; uint256 coreAmount1; uint256 hookReserves0; uint256 hookReserves1; uint256 hookEffective0; uint256 hookEffective1; uint160 sqrtPriceX96; int24 tick; uint128 activeLiquidity; uint256 blockNumber; address statsProvider; uint16 hookPermissions; bool hasCustomAccounting; uint8 statsStatus; }",
  "function getPoolTVL(address manager, PoolKey key) view returns (PoolTVL result)",
]);

export const CHAINLINK_FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
