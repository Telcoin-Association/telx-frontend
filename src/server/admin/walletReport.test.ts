/**
 * @jest-environment node
 */

import { encodeAbiParameters, encodeEventTopics, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { MERKL_POSITION_REGISTRY, isMerklUniswapPool } from "@/lib/contracts";
import type { ChainPositions } from "@/lib/positions";
import { SUBSCRIBER_FROM_BLOCK } from "@/server/pools/merkl/backfill";
import { POOL_MANAGER_EVENTS } from "@/server/pools/rpc/abi";
import { chainConfig, rpcPoolsFor } from "@/server/pools/registry";
import { walletReport, type ReportClient, type WalletReportDeps } from "./walletReport";

const config = chainConfig("polygon");
const PM = config.contracts.positionManager;
const POOL_MANAGER = config.contracts.poolManager;
const pool = rpcPoolsFor("polygon").find(candidate => isMerklUniswapPool(candidate.id))!;
const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const OTHER = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";

// Fixture blocks start at the TELx subscriber deployment, where the registry scan begins.
const START = SUBSCRIBER_FROM_BLOCK.polygon;
const HEAD = { block: START + 10_000, timestamp: 2_000_000_000 };
const blockAt = (offset: number) => START + offset;
const timeAt = (offset: number) => HEAD.timestamp - (HEAD.block - blockAt(offset)) * 2;

const REGISTRY_EVENTS = parseAbi([
  "event Subscribed(uint256 indexed tokenId, address indexed owner)",
  "event Unsubscribed(uint256 indexed tokenId, address indexed owner)",
]);
const PM_EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed id)",
  "event Unsubscription(uint256 indexed tokenId, address indexed subscriber)",
]);

type Log = { address: string; topics: Hex[]; data: Hex; blockNumber: number; logIndex: number; transactionHash: Hex };
const logs: Log[] = [];
let txCounter = 0;
const tx = () => toHex(++txCounter, { size: 32 });

function add(address: string, topics: Hex[], data: Hex, offset: number, hash: Hex = tx()) {
  logs.push({ address, topics, data, blockNumber: blockAt(offset), logIndex: logs.length, transactionHash: hash });
  return hash;
}
const salt = (tokenId: number) => pad(toHex(tokenId), { size: 32 });
const liquidity = (tokenId: number, d: bigint, offset: number, tickLower = -100, tickUpper = 100) =>
  add(
    POOL_MANAGER,
    encodeEventTopics({ abi: POOL_MANAGER_EVENTS, eventName: "ModifyLiquidity", args: { id: pool.id as Hex, sender: PM } }) as Hex[],
    encodeAbiParameters(
      [{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }],
      [tickLower, tickUpper, d, salt(tokenId)],
    ),
    offset,
  );
const swap = (tick: number, offset: number) =>
  add(
    POOL_MANAGER,
    encodeEventTopics({ abi: POOL_MANAGER_EVENTS, eventName: "Swap", args: { id: pool.id as Hex, sender: OTHER as Address } }) as Hex[],
    encodeAbiParameters(
      [{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }],
      [1n, -1n, 2n ** 96n, 1n, tick, 3000],
    ),
    offset,
  );
const registry = (eventName: "Subscribed" | "Unsubscribed", tokenId: number, offset: number, hash?: Hex) =>
  add(MERKL_POSITION_REGISTRY, encodeEventTopics({ abi: REGISTRY_EVENTS, eventName, args: { tokenId: BigInt(tokenId), owner: OWNER } }) as Hex[], "0x", offset, hash);
const transfer = (tokenId: number, to: string, offset: number, hash?: Hex) =>
  add(PM, encodeEventTopics({ abi: PM_EVENTS, eventName: "Transfer", args: { from: OWNER, to: to as Address, id: BigInt(tokenId) } }) as Hex[], "0x", offset, hash);

// Token 1: held, in range at first, out of range for a while, then back; subscribed after its add.
liquidity(1, 1000n, 100);
registry("Subscribed", 1, 110);
swap(0, 150);
swap(250, 200);
swap(5, 300);
// Token 2: subscribed, then burned: the registry's Unsubscribed and the burn share a transaction.
liquidity(2, 500n, 120);
registry("Subscribed", 2, 130);
liquidity(2, -500n, 400);
const burn = transfer(2, ZERO, 410);
registry("Unsubscribed", 2, 410, burn);
// Token 3: removed by the registry on its own; the transaction has no PositionManager event for it.
liquidity(3, 700n, 140);
registry("Subscribed", 3, 145);
const prune = registry("Unsubscribed", 3, 500);
// Token 4: unsubscribed by the holder through the PositionManager.
liquidity(4, 300n, 160);
registry("Subscribed", 4, 165);
const ownerUnsubscribe = add(
  PM,
  encodeEventTopics({ abi: PM_EVENTS, eventName: "Unsubscription", args: { tokenId: 4n, subscriber: OTHER as Address } }) as Hex[],
  "0x",
  600,
);
registry("Unsubscribed", 4, 600, ownerUnsubscribe);

const matches = (filter: { address: string | string[]; topics: (Hex | Hex[] | null)[] }, log: Log) => {
  const addresses = (Array.isArray(filter.address) ? filter.address : [filter.address]).map(a => a.toLowerCase());
  if (!addresses.includes(log.address.toLowerCase())) return false;
  return filter.topics.every((topic, i) => {
    if (topic === null) return true;
    const value = log.topics[i]?.toLowerCase();
    return Array.isArray(topic) ? topic.map(t => t.toLowerCase()).includes(value) : topic.toLowerCase() === value;
  });
};

const registryState: Record<string, Record<string, boolean>> = {
  "1": { isTokenSubscribed: true, isInRange: true, belowSubscriptionThreshold: false, subscriptionEligible: true },
  "3": { isTokenSubscribed: false, isInRange: true, belowSubscriptionThreshold: false, subscriptionEligible: true },
  "4": { isTokenSubscribed: false, isInRange: true, belowSubscriptionThreshold: false, subscriptionEligible: true },
};

function fakeClient(): ReportClient {
  return {
    request: async ({ method, params }) => {
      if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
      const [filter] = params as [{ address: string; topics: (Hex | Hex[] | null)[]; fromBlock: Hex; toBlock: Hex }];
      const from = Number(filter.fromBlock);
      const to = Number(filter.toBlock);
      return logs
        .filter(log => log.blockNumber >= from && log.blockNumber <= to && matches(filter, log))
        .map(log => ({
          ...log,
          blockNumber: toHex(log.blockNumber),
          logIndex: toHex(log.logIndex),
          blockHash: toHex(log.blockNumber, { size: 32 }),
          blockTimestamp: toHex(timeAt(log.blockNumber - START)),
        }));
    },
    multicall: async ({ contracts }) =>
      (contracts as { functionName: string; args: readonly unknown[] }[]).map(call => {
        if (call.functionName === "getSlot0") return { status: "success", result: [2n ** 96n, 5, 0, 3000] };
        const state = registryState[String(call.args[0])];
        if (!state) return { status: "failure", error: new Error("no position") };
        return { status: "success", result: state[call.functionName] };
      }),
    readContract: async ({ functionName }) => {
      if (functionName === "getSlot0") return [2n ** 96n, 0, 0, 3000];
      if (functionName === "inRangeRequired") return true;
      if (functionName === "unclaimedRewards") return 12345n;
      throw new Error(`unexpected ${functionName}`);
    },
    getBlock: async () => ({ number: BigInt(HEAD.block), timestamp: BigInt(HEAD.timestamp) }),
    getTransactionReceipt: async ({ hash }) => ({ logs: logs.filter(log => log.transactionHash === hash) }),
  };
}

const held: ChainPositions = {
  chain: "polygon",
  owner: OWNER,
  blockNumber: HEAD.block,
  truncated: false,
  pools: {
    [pool.id]: {
      claimableAmount: null,
      positions: [
        {
          tokenId: "1",
          isSubscribed: true,
          tickLower: -100,
          tickUpper: 100,
          liquidity: "1000",
          amounts: { amount0: "1.5", amount1: "2000", sqrtPriceX96: (2n ** 96n).toString() },
          price: { price1Per0: 1, price0Per1: 1 },
        },
      ],
    },
  },
};

const deps: WalletReportDeps = {
  chains: ["polygon"],
  client: () => fakeClient(),
  heldPositions: async () => held,
  merklRewards: async () => [{ symbol: "TEL", amount: "10", claimed: "4", claimable: "6", pending: "1", claimableUSD: 0.03 }],
  now: () => HEAD.timestamp * 1000,
};

describe("walletReport", () => {
  it("lists held, burned, pruned and unsubscribed positions with how each subscription ended", async () => {
    const report = await walletReport(OWNER, deps);
    const [chain] = report.chains;
    expect(chain.errors).toEqual([]);
    expect(chain.head).toEqual(HEAD);
    expect(chain.inRangeRequired).toBe(true);
    expect(chain.oldPoolsClaimable).toBe("123.45");
    expect(chain.merkl).toEqual([expect.objectContaining({ claimable: "6", pending: "1" })]);

    const byId = Object.fromEntries(chain.positions.map(position => [position.tokenId, position]));
    expect(Object.keys(byId).sort()).toEqual(["1", "2", "3", "4"]);
    expect(byId["1"]).toMatchObject({ status: "open", subscribed: true, inRangeNow: true, currentTick: 5, merklPool: true, poolId: pool.id });
    expect(byId["1"].amounts).toMatchObject({ amount0: "1.5", amount1: "2000" });
    expect(byId["2"]).toMatchObject({ status: "burned", liquidity: "0", registry: null });
    expect(byId["2"].subscriptions.map(event => [event.kind, event.how])).toEqual([
      ["subscribed", null],
      ["unsubscribed", "burned"],
    ]);
    expect(byId["3"].subscriptions.at(-1)?.how).toBe("registry");
    expect(byId["4"].subscriptions.at(-1)?.how).toBe("owner");
    expect(byId["1"].positionUrl).toBe(`https://polygonscan.com/nft/${PM}/1`);
  });

  it("times each position in and out of range from the pool's swaps", async () => {
    const report = await walletReport(OWNER, deps);
    const token1 = report.chains[0].positions.find(position => position.tokenId === "1")!;
    const range = token1.range!;
    // Swaps every 2 seconds per block: in range from the add (block 100) to block 200, out to 300, in since.
    expect(range.from).toBe(timeAt(100));
    expect(range.to).toBe(HEAD.timestamp);
    expect(range.outOfRangeSeconds).toBe(timeAt(300) - timeAt(200));
    expect(range.inRangeSeconds).toBe(HEAD.timestamp - timeAt(100) - range.outOfRangeSeconds);
    expect(range.subscribedSeconds).toBe(HEAD.timestamp - timeAt(110));
    expect(range.subscribedOutOfRangeSeconds).toBe(timeAt(300) - timeAt(200));

    const token2 = report.chains[0].positions.find(position => position.tokenId === "2")!;
    expect(token2.range!.activeSeconds).toBe(timeAt(400) - timeAt(120));
  });

  it("flags the registry removal", async () => {
    const report = await walletReport(OWNER, deps);
    expect(report.flags).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "removed-by-registry", tokenId: "3" })]));
    expect(report.flags.some(flag => flag.tokenId === "1" && flag.kind === "out-of-range")).toBe(false);
  });

  it("reports a failed chain read without failing the other chains", async () => {
    const report = await walletReport(OWNER, {
      ...deps,
      chains: ["polygon", "base"],
      client: chain => (chain === "base" ? { ...fakeClient(), getBlock: async () => Promise.reject(new Error("node down")) } : fakeClient()),
    });
    expect(report.chains.map(chain => chain.chain)).toEqual(["polygon", "base"]);
    expect(report.chains[1].errors[0]).toContain("Chain read failed");
    expect(report.chains[0].positions).toHaveLength(4);
  });

  it("notes a held-positions failure and still reads the history", async () => {
    const report = await walletReport(OWNER, { ...deps, heldPositions: async () => Promise.reject(new Error("token list failed")) });
    const chain = report.chains[0];
    expect(chain.errors.some(error => error.startsWith("Held positions"))).toBe(true);
    expect(chain.positions.find(position => position.tokenId === "1")?.status).toBe("unknown");
  });
});

