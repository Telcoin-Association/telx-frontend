import "server-only";

import { decodeEventLog, formatUnits, pad, parseAbi, toEventSelector, toHex, type Address, type Hex } from "viem";

import { decodePositionInfo, positionRegistryAbi } from "@/app/api/backendHelpers/helpers";
import { describeError } from "@/app/api/backendHelpers/errors";
import { BASE_POSITION_REGISTRY, MERKL_POSITION_REGISTRY, POLYGON_POSITION_REGISTRY, isMerklUniswapPool } from "@/lib/contracts";
import {
  ADMIN_WALLET_CHAINS,
  EXPLORER_URLS,
  type AdminChainReport,
  type AdminMerklReward,
  type AdminPosition,
  type AdminPositionStatus,
  type AdminSubscriptionEvent,
  type AdminWalletReport,
} from "@/lib/adminWallet";
import type { ChainPositions } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { readLogChunks, type ChainLog, type RpcRequester } from "@/server/chain/logs";
import { SUBSCRIBER_FROM_BLOCK } from "@/server/pools/merkl/backfill";
import { MODIFY_LIQUIDITY_TOPIC, POOL_MANAGER_EVENTS, STATE_VIEW_ABI, SWAP_TOPIC } from "@/server/pools/rpc/abi";
import { chainConfig, poolsFor, rpcPoolsFor, type RegistryPool, type RpcPool } from "@/server/pools/registry";
import { classifyUnsubscribe, TRANSFER_TOPIC, walletFlags } from "./flags";
import { isInRange, rangeTimeline, subscriptionIntervals, type TickPoint } from "./rangeTimeline";

/**
 * The admin wallet report: every TELx position a wallet holds or held on each chain, with its subscription
 * history, how long it spent out of range, the registry's view of it, and the wallet's rewards.
 *
 * Scope, to keep one request bounded:
 * - liquidity and tick history are read for the active registry pools, from their creation (the TELx
 *   subscriber's era). Positions in archived pools show their current state only;
 * - subscription history is the Merkl registry's Subscribed and Unsubscribed events for the wallet;
 * - at most MAX_POSITIONS positions per chain, the most recently active first.
 */

export const MAX_POSITIONS = 60;

/** Unsubscribe transactions read to tell how a subscription ended. */
export const MAX_RECEIPTS = 25;

/** Swap logs read per pool before the tick history stops early. */
export const MAX_SWAP_LOGS = 150_000;

/** Largest block span asked of the node in one eth_getLogs; the reader narrows it when a node refuses. */
export const LOG_MAX_SPAN = 2_000_000;

const REGISTRY_ABI = parseAbi([
  "event Subscribed(uint256 indexed tokenId, address indexed owner)",
  "event Unsubscribed(uint256 indexed tokenId, address indexed owner)",
  "function isTokenSubscribed(uint256 tokenId) view returns (bool)",
  "function isInRange(uint256 tokenId) view returns (bool)",
  "function belowSubscriptionThreshold(uint256 tokenId) view returns (bool)",
  "function subscriptionEligible(uint256 tokenId) view returns (bool)",
  "function inRangeRequired() view returns (bool)",
]);
const POSITION_INFO_ABI = parseAbi(["function positionInfo(uint256 tokenId) view returns (uint256)"]);
const SUBSCRIBED_TOPIC = toEventSelector(REGISTRY_ABI[0]);
const UNSUBSCRIBED_TOPIC = toEventSelector(REGISTRY_ABI[1]);

/** Old pools registries that hold claimable rewards, in legacy TEL with 2 decimals. */
const OLD_POOLS_REGISTRY: Partial<Record<RpcChain, Address>> = {
  base: BASE_POSITION_REGISTRY as Address,
  polygon: POLYGON_POSITION_REGISTRY as Address,
};
const LEGACY_TEL_DECIMALS = 2;

type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

export type ReportClient = RpcRequester & {
  multicall(args: { contracts: readonly unknown[]; allowFailure: true }): Promise<CallResult[]>;
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
  getBlock(args?: { blockTag?: "latest" }): Promise<{ number: bigint | null; timestamp: bigint }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{ logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[] }>;
};

export type WalletReportDeps = {
  client(chain: RpcChain): ReportClient;
  heldPositions(chain: RpcChain, owner: Address): Promise<ChainPositions>;
  merklRewards(chain: RpcChain, owner: Address): Promise<AdminMerklReward[]>;
  chains?: readonly RpcChain[];
  now?: () => number;
};

type LiquidityEvent = { poolId: string; tickLower: number; tickUpper: number; d: bigint; t: number; block: number; logIndex: number };

async function collectLogs(client: RpcRequester, filter: Parameters<typeof readLogChunks>[1], fromBlock: number, toBlock: number, cap = Infinity) {
  const logs: ChainLog[] = [];
  let complete = true;
  for await (const chunk of readLogChunks(client, filter, fromBlock, toBlock, { maxSpan: LOG_MAX_SPAN })) {
    logs.push(...chunk.logs);
    if (logs.length >= cap) {
      complete = chunk.toBlock >= toBlock;
      break;
    }
  }
  return { logs, complete };
}

const salted = (tokenId: string) => pad(toHex(BigInt(tokenId)), { size: 32 }).toLowerCase();
const poolIdPrefix = (poolId: string) => poolId.toLowerCase().slice(0, 52);

async function chainReport(chain: RpcChain, owner: Address, deps: WalletReportDeps): Promise<AdminChainReport> {
  const config = chainConfig(chain);
  const client = deps.client(chain);
  const positionManager = config.contracts.positionManager;
  const notes: string[] = [];
  const errors: string[] = [];
  const fail = (what: string) => (error: unknown) => {
    errors.push(`${what}: ${describeError(error)}`);
    return null;
  };

  const latest = await client.getBlock({ blockTag: "latest" });
  const head = { block: Number(latest.number ?? 0n), timestamp: Number(latest.timestamp) };
  const timeOf = (log: Pick<ChainLog, "blockNumber" | "blockTimestamp">) =>
    log.blockTimestamp ?? head.timestamp - Math.round((head.block - log.blockNumber) * config.blockTime);

  const activePools = rpcPoolsFor(chain);
  const allPools = poolsFor("uniswap", chain);
  const poolByPrefix = new Map<string, RegistryPool>(allPools.map(pool => [poolIdPrefix(pool.id), pool]));
  const activeById = new Map<string, RpcPool>(activePools.map(pool => [pool.id, pool]));
  const scanFrom = Math.min(SUBSCRIBER_FROM_BLOCK[chain], ...activePools.map(pool => pool.createdBlock));
  const ownerTopic = pad(owner.toLowerCase() as Hex, { size: 32 });
  const oldRegistry = OLD_POOLS_REGISTRY[chain];

  const [held, registryLogs, transfersOut, merkl, oldClaimable, inRangeRequired] = await Promise.all([
    deps.heldPositions(chain, owner).catch(fail("Held positions")),
    collectLogs(client, { address: MERKL_POSITION_REGISTRY, topics: [[SUBSCRIBED_TOPIC, UNSUBSCRIBED_TOPIC], null, ownerTopic] }, SUBSCRIBER_FROM_BLOCK[chain], head.block)
      .then(result => result.logs)
      .catch(fail("Registry events")),
    collectLogs(client, { address: positionManager, topics: [TRANSFER_TOPIC, ownerTopic] }, scanFrom, head.block)
      .then(result => result.logs)
      .catch(fail("Transfers")),
    deps.merklRewards(chain, owner).catch(fail("Merkl rewards")),
    oldRegistry
      ? client
          .readContract({ address: oldRegistry, abi: positionRegistryAbi, functionName: "unclaimedRewards", args: [owner] })
          .then(value => formatUnits(value as bigint, LEGACY_TEL_DECIMALS))
          .catch(fail("Old pools rewards"))
      : Promise.resolve(undefined),
    client
      .readContract({ address: MERKL_POSITION_REGISTRY, abi: REGISTRY_ABI, functionName: "inRangeRequired" })
      .then(value => value as boolean)
      .catch(fail("Registry settings")),
  ]);

  // Every token the wallet holds, subscribed through the registry, or sent away.
  const heldById = new Map<string, { poolId: string; position: ChainPositions["pools"][string]["positions"][number] }>();
  for (const [poolId, pool] of Object.entries(held?.pools ?? {})) {
    for (const position of pool.positions) heldById.set(position.tokenId, { poolId, position });
  }
  if (held?.truncated) notes.push("The wallet's token list was cut short, so some held positions may be missing.");

  const subscriptionLogs = new Map<string, ChainLog[]>();
  for (const log of registryLogs ?? []) {
    const tokenId = BigInt(log.topics[1]).toString();
    subscriptionLogs.set(tokenId, [...(subscriptionLogs.get(tokenId) ?? []), log]);
  }
  const lastTransferOut = new Map<string, { to: string; block: number }>();
  for (const log of transfersOut ?? []) {
    const tokenId = BigInt(log.topics[3]).toString();
    const previous = lastTransferOut.get(tokenId);
    if (!previous || log.blockNumber >= previous.block) lastTransferOut.set(tokenId, { to: `0x${log.topics[2].slice(26)}`.toLowerCase(), block: log.blockNumber });
  }

  const candidates = [...new Set([...heldById.keys(), ...subscriptionLogs.keys(), ...lastTransferOut.keys()])];

  // Liquidity changes of every PositionManager position in the active pools, kept for the candidates.
  const saltToToken = new Map(candidates.map(tokenId => [salted(tokenId), tokenId]));
  const liquidityByToken = new Map<string, LiquidityEvent[]>();
  if (activePools.length > 0 && candidates.length > 0) {
    const scanned = await collectLogs(
      client,
      { address: config.contracts.poolManager, topics: [MODIFY_LIQUIDITY_TOPIC, activePools.map(pool => pool.id as Hex), pad(positionManager, { size: 32 })] },
      Math.min(...activePools.map(pool => pool.createdBlock)),
      head.block,
    ).catch(fail("Liquidity history"));
    for (const log of scanned?.logs ?? []) {
      const decoded = decodeEventLog({ abi: POOL_MANAGER_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "ModifyLiquidity") continue;
      const tokenId = saltToToken.get(decoded.args.salt.toLowerCase());
      if (!tokenId) continue;
      liquidityByToken.set(tokenId, [
        ...(liquidityByToken.get(tokenId) ?? []),
        {
          poolId: decoded.args.id.toLowerCase(),
          tickLower: decoded.args.tickLower,
          tickUpper: decoded.args.tickUpper,
          d: decoded.args.liquidityDelta,
          t: timeOf(log),
          block: log.blockNumber,
          logIndex: log.logIndex,
        },
      ]);
    }
  }

  const lastActivity = (tokenId: string) =>
    Math.max(
      heldById.has(tokenId) ? Number.MAX_SAFE_INTEGER : 0,
      ...(liquidityByToken.get(tokenId) ?? []).map(event => event.block),
      ...(subscriptionLogs.get(tokenId) ?? []).map(log => log.blockNumber),
      lastTransferOut.get(tokenId)?.block ?? 0,
    );
  const tokens = candidates.sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, MAX_POSITIONS);
  if (candidates.length > tokens.length) notes.push(`Showing the ${MAX_POSITIONS} most recently active of ${candidates.length} positions.`);

  // Pool and range of each token: held positions from their read, the rest from their liquidity events or
  // the PositionManager's positionInfo when the token still exists.
  const unplaced = tokens.filter(tokenId => !heldById.has(tokenId) && !liquidityByToken.has(tokenId));
  const infos = unplaced.length
    ? await client
        .multicall({ allowFailure: true, contracts: unplaced.map(tokenId => ({ address: positionManager, abi: POSITION_INFO_ABI, functionName: "positionInfo", args: [BigInt(tokenId)] })) })
        .catch(fail("Position info"))
    : [];
  const placed = new Map<string, { poolId: string | null; tickLower: number | null; tickUpper: number | null }>();
  unplaced.forEach((tokenId, i) => {
    const result = infos?.[i];
    if (result?.status !== "success") return placed.set(tokenId, { poolId: null, tickLower: null, tickUpper: null });
    const word = result.result as bigint;
    const pool = poolByPrefix.get(toHex(word, { size: 32 }).slice(0, 52));
    const decoded = decodePositionInfo(word);
    placed.set(tokenId, { poolId: pool?.id ?? null, tickLower: decoded.getTickLower(), tickUpper: decoded.getTickUpper() });
  });

  const shape = tokens.map(tokenId => {
    const heldEntry = heldById.get(tokenId);
    const events = liquidityByToken.get(tokenId) ?? [];
    const poolId = heldEntry?.poolId ?? events[0]?.poolId ?? placed.get(tokenId)?.poolId ?? null;
    const tickLower = heldEntry?.position.tickLower ?? events[0]?.tickLower ?? placed.get(tokenId)?.tickLower ?? null;
    const tickUpper = heldEntry?.position.tickUpper ?? events[0]?.tickUpper ?? placed.get(tokenId)?.tickUpper ?? null;
    const liquidity = heldEntry ? BigInt(heldEntry.position.liquidity) : events.reduce((sum, event) => sum + event.d, 0n);
    const transfer = lastTransferOut.get(tokenId);
    let status: AdminPositionStatus;
    if (heldEntry) status = liquidity > 0n ? "open" : "empty";
    else if (transfer) status = transfer.to === "0x0000000000000000000000000000000000000000" ? "burned" : "transferred";
    else status = "unknown";
    return { tokenId, heldEntry, events, poolId, tickLower, tickUpper, liquidity, status };
  });

  // The registry's view of Merkl pool positions that still exist, and the current tick of each pool.
  const registryTokens = shape.filter(entry => entry.poolId && isMerklUniswapPool(entry.poolId) && entry.status !== "burned");
  const poolIds = [...new Set(shape.map(entry => entry.poolId).filter((id): id is string => id !== null))];
  const [registryReads, slot0Reads] = await Promise.all([
    registryTokens.length
      ? client
          .multicall({
            allowFailure: true,
            contracts: registryTokens.flatMap(({ tokenId }) =>
              (["isTokenSubscribed", "isInRange", "belowSubscriptionThreshold", "subscriptionEligible"] as const).map(functionName => ({
                address: MERKL_POSITION_REGISTRY,
                abi: REGISTRY_ABI,
                functionName,
                args: [BigInt(tokenId)],
              })),
            ),
          })
          .catch(fail("Registry reads"))
      : Promise.resolve([]),
    poolIds.length
      ? client
          .multicall({ allowFailure: true, contracts: poolIds.map(poolId => ({ address: config.contracts.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId] })) })
          .catch(fail("Pool prices"))
      : Promise.resolve([]),
  ]);
  const boolAt = (index: number) => {
    const result = registryReads?.[index];
    return result?.status === "success" ? (result.result as boolean) : null;
  };
  const registryById = new Map(
    registryTokens.map(({ tokenId }, i) => [
      tokenId,
      { subscribed: boolAt(i * 4), isInRange: boolAt(i * 4 + 1), belowThreshold: boolAt(i * 4 + 2), eligible: boolAt(i * 4 + 3) },
    ]),
  );
  const tickByPool = new Map<string, number>();
  poolIds.forEach((poolId, i) => {
    const result = slot0Reads?.[i];
    if (result?.status === "success") tickByPool.set(poolId, Number((result.result as readonly [bigint, number])[1]));
  });

  // Tick history of each active pool from the earliest liquidity change of the wallet's positions in it.
  const ticksByPool = new Map<string, { startTick: number | null; ticks: TickPoint[]; complete: boolean }>();
  const firstBlockByPool = new Map<string, number>();
  for (const entry of shape) {
    const first = entry.events[0];
    if (!first || !activeById.has(first.poolId)) continue;
    firstBlockByPool.set(first.poolId, Math.min(firstBlockByPool.get(first.poolId) ?? Infinity, first.block));
  }
  await Promise.all(
    [...firstBlockByPool].map(async ([poolId, fromBlock]) => {
      const [startTick, swaps] = await Promise.all([
        client
          .readContract({ address: config.contracts.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId], blockNumber: BigInt(fromBlock - 1) })
          .then(result => Number((result as readonly [bigint, number])[1]))
          .catch(() => null),
        collectLogs(client, { address: config.contracts.poolManager, topics: [SWAP_TOPIC, poolId as Hex] }, fromBlock, head.block, MAX_SWAP_LOGS).catch(
          fail(`Swaps in ${activeById.get(poolId)?.name ?? poolId}`),
        ),
      ]);
      if (!swaps) return;
      const ticks: TickPoint[] = [];
      for (const log of swaps.logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)) {
        const decoded = decodeEventLog({ abi: POOL_MANAGER_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (decoded.eventName === "Swap") ticks.push({ t: timeOf(log), tick: decoded.args.tick });
      }
      ticksByPool.set(poolId, { startTick, ticks, complete: swaps.complete });
      if (!swaps.complete) notes.push(`The tick history of ${activeById.get(poolId)?.name ?? poolId} stops early, so its range times are partial.`);
    }),
  );

  // How unsubscribes happened, newest first, within the receipt budget.
  const unsubscribeLogs = (registryLogs ?? []).filter(log => log.topics[0].toLowerCase() === UNSUBSCRIBED_TOPIC).sort((a, b) => b.blockNumber - a.blockNumber);
  const howByLog = new Map<string, AdminSubscriptionEvent["how"]>();
  await Promise.all(
    unsubscribeLogs.slice(0, MAX_RECEIPTS).map(async log => {
      const tokenId = BigInt(log.topics[1]);
      const receipt = await client.getTransactionReceipt({ hash: log.transactionHash }).catch(() => null);
      howByLog.set(`${log.transactionHash}:${log.logIndex}`, receipt ? classifyUnsubscribe(receipt.logs, tokenId, positionManager) : "unknown");
    }),
  );
  if (unsubscribeLogs.length > MAX_RECEIPTS) notes.push(`Only the ${MAX_RECEIPTS} most recent unsubscribes say how they happened.`);

  const positions: AdminPosition[] = shape.map(entry => {
    const pool = entry.poolId ? allPools.find(candidate => candidate.id === entry.poolId) ?? null : null;
    const merklPool = entry.poolId ? isMerklUniswapPool(entry.poolId) : false;
    const registry = registryById.get(entry.tokenId) ?? null;
    const currentTick = entry.poolId ? tickByPool.get(entry.poolId) ?? null : null;
    const inRangeNow =
      entry.status === "open" && currentTick !== null && entry.tickLower !== null && entry.tickUpper !== null
        ? isInRange(currentTick, entry.tickLower, entry.tickUpper)
        : null;

    const subscriptions: AdminSubscriptionEvent[] = (subscriptionLogs.get(entry.tokenId) ?? [])
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
      .map(log => {
        const kind = log.topics[0].toLowerCase() === SUBSCRIBED_TOPIC ? "subscribed" : "unsubscribed";
        return {
          kind,
          t: timeOf(log),
          block: log.blockNumber,
          txHash: log.transactionHash,
          how: kind === "unsubscribed" ? howByLog.get(`${log.transactionHash}:${log.logIndex}`) ?? null : null,
        };
      });

    const poolTicks = entry.poolId ? ticksByPool.get(entry.poolId) : undefined;
    let range: AdminPosition["range"] = null;
    if (poolTicks && entry.events.length > 0 && entry.tickLower !== null && entry.tickUpper !== null) {
      const from = entry.events[0].t;
      const before = poolTicks.ticks.filter(point => point.t < from);
      range = rangeTimeline({
        from,
        to: head.timestamp,
        tickLower: entry.tickLower,
        tickUpper: entry.tickUpper,
        startTick: before.length ? before[before.length - 1].tick : poolTicks.startTick,
        ticks: poolTicks.ticks,
        liquidityAtStart: 0n,
        liquidity: entry.events.map(event => ({ t: event.t, d: event.d })),
        subscribed: subscriptionIntervals(subscriptions, head.timestamp),
      });
    }

    const subscribed = registry?.subscribed ?? (entry.heldEntry ? entry.heldEntry.position.isSubscribed : null);
    const amounts = entry.heldEntry && pool?.key
      ? {
          amount0: entry.heldEntry.position.amounts.amount0,
          amount1: entry.heldEntry.position.amounts.amount1,
          symbol0: config.tokens[pool.key.currency0]?.symbol ?? "token0",
          symbol1: config.tokens[pool.key.currency1]?.symbol ?? "token1",
        }
      : null;

    return {
      chain,
      tokenId: entry.tokenId,
      poolId: entry.poolId,
      poolName: pool?.name ?? null,
      merklPool,
      status: entry.status,
      tickLower: entry.tickLower,
      tickUpper: entry.tickUpper,
      liquidity: entry.liquidity.toString(),
      amounts,
      currentTick,
      inRangeNow,
      subscribed,
      registry: registry ? { isInRange: registry.isInRange, belowThreshold: registry.belowThreshold, eligible: registry.eligible } : null,
      subscriptions,
      range,
      positionUrl: `${EXPLORER_URLS[chain]}/nft/${positionManager}/${entry.tokenId}`,
    };
  });

  if (positions.some(position => position.poolId && !activeById.has(position.poolId))) {
    notes.push("Positions in archived pools show their current state only; their history isn't read.");
  }

  return {
    chain,
    head,
    inRangeRequired: inRangeRequired ?? null,
    positions,
    merkl: merkl ?? null,
    ...(oldRegistry ? { oldPoolsClaimable: oldClaimable ?? null } : {}),
    notes,
    errors,
  };
}


export async function walletReport(owner: Address, deps: WalletReportDeps): Promise<AdminWalletReport> {
  const chains = deps.chains ?? ADMIN_WALLET_CHAINS;
  const reports = await Promise.all(
    chains.map(chain =>
      chainReport(chain, owner, deps).catch(
        (error): AdminChainReport => ({
          chain,
          head: null,
          inRangeRequired: null,
          positions: [],
          merkl: null,
          notes: [],
          errors: [`Chain read failed: ${describeError(error)}`],
        }),
      ),
    ),
  );
  return {
    address: owner.toLowerCase(),
    generatedAt: Math.floor((deps.now ?? Date.now)() / 1000),
    chains: reports,
    flags: walletFlags(reports.flatMap(report => report.positions)),
  };
}
