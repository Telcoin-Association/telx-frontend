import { decodeEventLog, parseAbi, toEventSelector, type Hex } from "viem";
import type { AdminFlag, AdminPosition, UnsubscribeHow } from "@/lib/adminWallet";

/** The PositionManager events that tell how a subscription ended. */
export const POSITION_MANAGER_EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed id)",
  "event Unsubscription(uint256 indexed tokenId, address indexed subscriber)",
]);
export const TRANSFER_TOPIC = toEventSelector(POSITION_MANAGER_EVENTS[0]);
export const UNSUBSCRIPTION_TOPIC = toEventSelector(POSITION_MANAGER_EVENTS[1]);

const ZERO = "0x0000000000000000000000000000000000000000";

/** Share of subscribed time out of range above which a position is flagged even when it is in range now. */
export const MOSTLY_OUT_OF_RANGE_SHARE = 0.25;

type ReceiptLog = { address: string; topics: readonly Hex[]; data: Hex };

/**
 * How the subscription of `tokenId` ended, from the logs of the transaction that emitted the registry's
 * Unsubscribed. A burn or transfer of the token in that transaction ends it that way; the PositionManager's
 * Unsubscription means the holder unsubscribed; with neither, the registry removed it on its own.
 */
export function classifyUnsubscribe(logs: readonly ReceiptLog[], tokenId: bigint, positionManager: string): UnsubscribeHow {
  let how: UnsubscribeHow = "registry";
  for (const log of logs) {
    if (log.address.toLowerCase() !== positionManager.toLowerCase()) continue;
    const topic = log.topics[0]?.toLowerCase();
    if (topic !== TRANSFER_TOPIC && topic !== UNSUBSCRIPTION_TOPIC) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: POSITION_MANAGER_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch {
      continue;
    }
    if (decoded.eventName === "Transfer" && decoded.args.id === tokenId) {
      return decoded.args.to.toLowerCase() === ZERO ? "burned" : "transferred";
    }
    if (decoded.eventName === "Unsubscription" && decoded.args.tokenId === tokenId) how = "owner";
  }
  return how;
}

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/** Support flags for a wallet's positions, most actionable first. */
export function walletFlags(positions: readonly AdminPosition[]): AdminFlag[] {
  const flags: AdminFlag[] = [];
  const add = (position: AdminPosition, kind: AdminFlag["kind"], message: string) =>
    flags.push({ kind, chain: position.chain, tokenId: position.tokenId, message });

  for (const position of positions) {
    const name = `#${position.tokenId}${position.poolName ? ` (${position.poolName})` : ""}`;
    if (position.status === "open") {
      if (position.merklPool && position.subscribed && position.inRangeNow === false) {
        add(position, "subscribed-out-of-range", `${name} is subscribed but out of range, so it earns no rewards until the price returns.`);
      } else if (position.inRangeNow === false) {
        add(position, "out-of-range", `${name} is out of range now.`);
      }
      if (position.merklPool && position.subscribed === false) {
        if (position.registry?.eligible === false) add(position, "not-eligible", `${name} isn't subscribed, and the registry says it isn't eligible to subscribe.`);
        else add(position, "not-subscribed", `${name} has liquidity in a TELx pool but isn't subscribed, so it earns no rewards.`);
      }
      if (position.registry?.belowThreshold) add(position, "below-threshold", `${name} is below the pool's minimum liquidity for rewards.`);
      if (!position.merklPool) add(position, "old-program-pool", `${name} is in a pool outside the current TELx program, which pays no Merkl rewards.`);
    }
    if (position.status === "empty" && position.subscribed) {
      add(position, "empty-still-subscribed", `${name} has no liquidity left but is still subscribed. It can be unsubscribed.`);
    }
    for (const event of position.subscriptions) {
      if (event.kind === "unsubscribed" && event.how === "registry") {
        add(position, "removed-by-registry", `${name} was removed from the registry without the holder unsubscribing (pruned or force-unsubscribed).`);
      }
    }
    const range = position.range;
    if (
      range &&
      range.subscribedSeconds > 0 &&
      range.subscribedOutOfRangeSeconds / range.subscribedSeconds > MOSTLY_OUT_OF_RANGE_SHARE &&
      !(position.status === "open" && position.inRangeNow === false && position.subscribed)
    ) {
      add(
        position,
        "mostly-out-of-range",
        `${name} spent ${pct(range.subscribedOutOfRangeSeconds, range.subscribedSeconds)} of its subscribed time out of range.`,
      );
    }
  }

  const order: AdminFlag["kind"][] = [
    "subscribed-out-of-range",
    "not-subscribed",
    "not-eligible",
    "below-threshold",
    "removed-by-registry",
    "mostly-out-of-range",
    "out-of-range",
    "empty-still-subscribed",
    "old-program-pool",
  ];
  return flags.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
