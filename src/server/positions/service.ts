import "server-only";
import type { Address } from "viem";
import { positionManagerAbi } from "@/app/api/backendHelpers/helpers";
import { listOwnedTokenIds } from "@/app/api/backendHelpers/positionTokens";
import type { ChainPositions } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { createShortCache } from "../shortCache";
import { positionsChain } from "./chains";
import { readPositions } from "./read";
import { applyTransfers, readHead, readPositionTransfers, transferWindow } from "./transfers";

/** Time allowed for the Alchemy token listing, retries included, so the reads after it still fit the route's maxDuration. */
export const TOKEN_LIST_BUDGET_MS = 15_000;

/** How long one owner's positions are reused on an instance, so a burst of refetches does not list the wallet again. */
export const POSITIONS_CACHE_TTL_MS = 4_000;

/**
 * The owner's Uniswap v4 positions in every registry pool on `chain`, read fresh.
 *
 * Candidate token ids are Alchemy's getNFTsForOwner list with the transfer window applied: tokens the
 * owner received in the window are added, even while Alchemy's index lags, and tokens sent away are
 * dropped. `readPositions` then keeps only the ids `ownerOf` confirms, so a stale listing cannot show a
 * position the wallet no longer holds. `blockNumber` is the head read first; every later read is at that
 * block or newer.
 */
export async function loadChainPositions(chain: RpcChain, owner: Address): Promise<ChainPositions> {
  const { client, positionManager } = positionsChain(chain);
  const head = await readHead(client);
  const range = transferWindow(chain, head);

  const transfers = Promise.all([
    readPositionTransfers(client, positionManager, range, { to: owner }),
    readPositionTransfers(client, positionManager, range, { from: owner }),
  ]).then(([received, sent]) => [...received, ...sent]);

  const [listed, recent] = await Promise.all([
    listOwnedTokenIds({
      chain,
      owner,
      contract: positionManager,
      deadline: Date.now() + TOKEN_LIST_BUDGET_MS,
      expectedCount: () =>
        client.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "balanceOf", args: [owner] }).then(Number),
      reconcile: async ids => applyTransfers(ids, await transfers, owner),
    }),
    transfers,
  ]);

  const tokenIds = applyTransfers(listed.ids, recent, owner);
  const pools = await readPositions({ client, chain, positionManager, owner, tokenIds });
  return { chain, owner: owner.toLowerCase(), blockNumber: Number(head), truncated: listed.truncated, pools };
}

const positionsCache = createShortCache<ChainPositions>({ ttlMs: POSITIONS_CACHE_TTL_MS, maxEntries: 1_000 });

/**
 * `loadChainPositions` behind a short per-(chain, owner) cache with in-flight sharing. With `minBlock`,
 * a cached or in-flight result read before that block is not reused, so a refetch prompted by a transfer
 * or a confirmed transaction in block `minBlock` always reads again.
 */
export function getChainPositions(chain: RpcChain, owner: Address, minBlock?: number): Promise<ChainPositions> {
  const key = `${chain}:${owner.toLowerCase()}`;
  return positionsCache.get(
    key,
    () => loadChainPositions(chain, owner),
    cached => minBlock === undefined || cached.blockNumber >= minBlock,
  );
}

/** Test hook: forget cached positions. */
export function clearPositionsCache() {
  positionsCache.clear();
}
