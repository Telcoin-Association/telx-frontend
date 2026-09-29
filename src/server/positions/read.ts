import "server-only";
import { formatUnits, toHex, type Address, type ContractFunctionParameters } from "viem";
import { decodePositionInfo, formatSqrtPriceX96, positionManagerAbi, positionRegistryAbi } from "@/app/api/backendHelpers/helpers";
import { describeError } from "@/app/api/backendHelpers/errors";
import { listUniswapV4Pools, type UniswapV4Pool } from "@/app/api/backendHelpers/uniswapPools";
import { getUniswapChainAddresses } from "@/lib/contracts";
import type { PoolPositions, Position } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import type { PositionsClient } from "./chains";

/**
 * Calldata bytes per Multicall3 aggregate call. viem splits larger batches into several eth_calls sent
 * in parallel. At about 36 bytes per read, one call carries a few hundred reads.
 */
export const MULTICALL_BATCH_BYTES = 16_384;

type MulticallClient = Pick<PositionsClient, "multicall">;
type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

/** The first 25 bytes of a v4 pool id, which is what PositionInfo stores (0x plus 50 hex characters). */
const poolIdPrefix = (poolId: string) => poolId.toLowerCase().slice(0, 52);

function multicall(client: MulticallClient, contracts: ContractFunctionParameters[]): Promise<CallResult[]> {
  if (contracts.length === 0) return Promise.resolve([]);
  return client.multicall({ contracts, allowFailure: true, batchSize: MULTICALL_BATCH_BYTES }) as Promise<CallResult[]>;
}

type Held = {
  tokenId: string;
  pool: UniswapV4Pool;
  registry: Address;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
};

export type ReadPositionsOptions = {
  client: MulticallClient;
  chain: RpcChain;
  positionManager: Address;
  owner: Address;
  tokenIds: string[];
};

/**
 * The owner's positions in every Uniswap v4 registry pool on `chain`, keyed by lowercase pool id, with
 * the pool's registry `unclaimedRewards` for the owner. Every registry pool on the chain has an entry.
 *
 * Two multicall rounds, whatever the number of tokens:
 * 1. `ownerOf`, `positionInfo` and `getPositionLiquidity` for every candidate id. An id the owner does
 *    not hold, one that reverts (burned), or one in a pool outside the registry is dropped here.
 * 2. `isTokenSubscribed` and `getAmountsForLiquidity` on the pool's position registry for the ids that
 *    are left, plus `unclaimedRewards` once per registry.
 * A read that fails for one token drops that token with a warning; a failed multicall rejects.
 */
export async function readPositions({
  client,
  chain,
  positionManager,
  owner,
  tokenIds,
}: ReadPositionsOptions): Promise<Record<string, PoolPositions>> {
  const pools = listUniswapV4Pools(chain);
  const poolsByPrefix = new Map(pools.map(pool => [poolIdPrefix(pool.poolId), pool]));
  const registryOf = (pool: UniswapV4Pool) => getUniswapChainAddresses(chain, pool.poolId).positionRegistry as Address;
  const account = owner.toLowerCase();

  const ids = tokenIds.map(id => BigInt(id));
  const first = await multicall(
    client,
    ids.flatMap(id => [
      { address: positionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [id] },
      { address: positionManager, abi: positionManagerAbi, functionName: "positionInfo", args: [id] },
      { address: positionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [id] },
    ]),
  );

  const held: Held[] = [];
  tokenIds.forEach((tokenId, i) => {
    const [ownerOf, info, liquidity] = first.slice(i * 3, i * 3 + 3);
    if (ownerOf?.status !== "success" || String(ownerOf.result).toLowerCase() !== account) return;
    if (info?.status !== "success" || liquidity?.status !== "success") {
      const error = info?.status === "failure" ? info.error : liquidity?.status === "failure" ? liquidity.error : "missing result";
      console.warn(`Failed to read position ${tokenId} on ${chain}:`, describeError(error));
      return;
    }
    const word = info.result as bigint;
    const pool = poolsByPrefix.get(toHex(word, { size: 32 }).slice(0, 52));
    if (!pool) return;
    const decoded = decodePositionInfo(word);
    held.push({
      tokenId,
      pool,
      registry: registryOf(pool),
      liquidity: liquidity.result as bigint,
      tickLower: decoded.getTickLower(),
      tickUpper: decoded.getTickUpper(),
    });
  });

  const registries = [...new Map(pools.map(pool => [registryOf(pool).toLowerCase(), registryOf(pool)])).values()];
  const second = await multicall(client, [
    ...held.flatMap(({ tokenId, pool, registry, liquidity, tickLower, tickUpper }) => [
      { address: registry, abi: positionRegistryAbi, functionName: "isTokenSubscribed", args: [BigInt(tokenId)] },
      { address: registry, abi: positionRegistryAbi, functionName: "getAmountsForLiquidity", args: [pool.poolId, liquidity, tickLower, tickUpper] },
    ]),
    ...registries.map(registry => ({ address: registry, abi: positionRegistryAbi, functionName: "unclaimedRewards", args: [owner] })),
  ]);

  const claimable = new Map<string, string | null>();
  registries.forEach((registry, i) => {
    const result = second[held.length * 2 + i];
    if (result?.status === "success") {
      claimable.set(registry.toLowerCase(), (result.result as bigint).toString());
    } else {
      console.warn(`Failed to read unclaimed rewards on ${chain}:`, describeError(result?.status === "failure" ? result.error : "missing result"));
      claimable.set(registry.toLowerCase(), null);
    }
  });

  const byPool: Record<string, PoolPositions> = {};
  for (const pool of pools) {
    byPool[pool.poolId.toLowerCase()] = { positions: [], claimableAmount: claimable.get(registryOf(pool).toLowerCase()) ?? null };
  }

  held.forEach(({ tokenId, pool, liquidity, tickLower, tickUpper }, i) => {
    const [subscribed, amounts] = second.slice(i * 2, i * 2 + 2);
    if (subscribed?.status !== "success" || amounts?.status !== "success") {
      const error = subscribed?.status === "failure" ? subscribed.error : amounts?.status === "failure" ? amounts.error : "missing result";
      console.warn(`Failed to read position ${tokenId} on ${chain}:`, describeError(error));
      return;
    }
    const [amount0, amount1, sqrtPriceX96] = amounts.result as readonly [bigint, bigint, bigint];
    const position: Position = {
      tokenId,
      isSubscribed: subscribed.result as boolean,
      tickLower,
      tickUpper,
      liquidity: liquidity.toString(),
      amounts: {
        amount0: formatUnits(amount0, pool.amount0Decimals),
        amount1: formatUnits(amount1, pool.amount1Decimals),
        sqrtPriceX96: sqrtPriceX96.toString(),
      },
      price: {
        price1Per0: formatSqrtPriceX96(sqrtPriceX96, pool.amount0Decimals, pool.amount1Decimals),
        price0Per1: formatSqrtPriceX96(sqrtPriceX96, pool.amount1Decimals, pool.amount0Decimals),
      },
    };
    byPool[pool.poolId.toLowerCase()].positions.push(position);
  });

  return byPool;
}
