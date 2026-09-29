import "server-only";
import { parseAbiItem, type Address } from "viem";
import { TRANSFER_WINDOW_BLOCKS, type PositionTransfer, type TransferFeed } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { readEventLogs, withTimeout, type LogClient } from "../chain/logs";
import { createShortCache } from "../shortCache";
import { positionsChain, type PositionsClient } from "./chains";

/** ERC-721 Transfer, which the PositionManager emits on every mint, transfer and burn of a position. */
export const ERC721_TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

/** Upper bound on the eth_blockNumber that starts every window read. */
const HEAD_READ_TIMEOUT_MS = 5_000;

/** The inclusive block range of a chain's transfer window ending at `head`. */
export function transferWindow(chain: RpcChain, head: bigint): { fromBlock: bigint; toBlock: bigint } {
  const span = BigInt(TRANSFER_WINDOW_BLOCKS[chain]);
  const fromBlock = head >= span ? head - span + 1n : 0n;
  return { fromBlock, toBlock: head };
}

/** The latest block number, read fresh rather than from viem's per-client block number cache. */
export function readHead(client: Pick<PositionsClient, "getBlockNumber">): Promise<bigint> {
  return withTimeout(client.getBlockNumber({ cacheTime: 0 }), HEAD_READ_TIMEOUT_MS, "eth_blockNumber");
}

const byChainOrder = (a: PositionTransfer, b: PositionTransfer) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;

/**
 * PositionManager transfers in an inclusive block range, oldest first, in one eth_getLogs. `filter`
 * narrows by the indexed `from` or `to`; both at once match only transfers between those two addresses.
 */
export async function readPositionTransfers(
  client: LogClient,
  positionManager: Address,
  range: { fromBlock: bigint; toBlock: bigint },
  filter?: { from?: Address; to?: Address },
): Promise<PositionTransfer[]> {
  const logs = await readEventLogs(client, { address: positionManager, event: ERC721_TRANSFER_EVENT, args: filter, ...range });
  const transfers: PositionTransfer[] = [];
  for (const log of logs) {
    if (log.blockNumber === null || log.logIndex === null) continue;
    transfers.push({
      tokenId: log.args.tokenId.toString(),
      from: log.args.from.toLowerCase(),
      to: log.args.to.toLowerCase(),
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
    });
  }
  return transfers.sort(byChainOrder);
}

/** Every PositionManager transfer on `chain` in the window ending at the current head: one eth_blockNumber and one eth_getLogs. */
export async function loadTransferFeed(chain: RpcChain): Promise<TransferFeed> {
  const { client, positionManager } = positionsChain(chain);
  const head = await readHead(client);
  const range = transferWindow(chain, head);
  const transfers = await readPositionTransfers(client, positionManager, range);
  return { chain, head: Number(head), fromBlock: Number(range.fromBlock), transfers };
}

// The edge cache in front of the feed route absorbs almost all traffic. This only stops concurrent cache
// misses that land on one instance from each reading the chain.
const feedCache = createShortCache<TransferFeed>({ ttlMs: 1_000, maxEntries: 8 });

export function readTransferFeed(chain: RpcChain): Promise<TransferFeed> {
  return feedCache.get(chain, () => loadTransferFeed(chain));
}

/** Test hook: forget cached feeds. */
export function clearTransferFeedCache() {
  feedCache.clear();
}
