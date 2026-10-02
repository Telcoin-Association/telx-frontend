import { encodeEventTopics, type Address, type Hex } from "viem";
import type { AdminPosition } from "@/lib/adminWallet";
import { classifyUnsubscribe, POSITION_MANAGER_EVENTS, walletFlags } from "./flags";

const PM = "0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9";
const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const log = (eventName: "Transfer" | "Unsubscription", args: Record<string, unknown>, address = PM) => ({
  address,
  topics: encodeEventTopics({ abi: POSITION_MANAGER_EVENTS, eventName, args } as never) as Hex[],
  data: "0x" as Hex,
});

describe("classifyUnsubscribe", () => {
  it("reads a burn, a transfer and a holder unsubscribe from the transaction's PositionManager logs", () => {
    expect(classifyUnsubscribe([log("Transfer", { from: OWNER, to: "0x0000000000000000000000000000000000000000", id: 7n })], 7n, PM)).toBe("burned");
    expect(classifyUnsubscribe([log("Transfer", { from: OWNER, to: "0x00000000000000000000000000000000000000bb", id: 7n })], 7n, PM)).toBe("transferred");
    expect(classifyUnsubscribe([log("Unsubscription", { tokenId: 7n, subscriber: OWNER })], 7n, PM)).toBe("owner");
  });

  it("calls it a registry removal when the PositionManager logged nothing for the token", () => {
    expect(classifyUnsubscribe([], 7n, PM)).toBe("registry");
    expect(classifyUnsubscribe([log("Unsubscription", { tokenId: 8n, subscriber: OWNER })], 7n, PM)).toBe("registry");
    expect(classifyUnsubscribe([log("Unsubscription", { tokenId: 7n, subscriber: OWNER }, "0x00000000000000000000000000000000000000cc")], 7n, PM)).toBe("registry");
  });
});

const position = (overrides: Partial<AdminPosition>): AdminPosition => ({
  chain: "polygon",
  tokenId: "1",
  poolId: "0xpool",
  poolName: "WETH/TEL",
  merklPool: true,
  status: "open",
  tickLower: -100,
  tickUpper: 100,
  liquidity: "1",
  amounts: null,
  currentTick: 0,
  inRangeNow: true,
  subscribed: true,
  registry: { isInRange: true, belowThreshold: false, eligible: true },
  subscriptions: [],
  range: null,
  positionUrl: "",
  ...overrides,
});

const kinds = (positions: AdminPosition[]) => walletFlags(positions).map(flag => flag.kind);

describe("walletFlags", () => {
  it("has nothing to say about a subscribed position in range", () => {
    expect(kinds([position({})])).toEqual([]);
  });

  it("flags a subscribed position out of range as earning nothing, once", () => {
    expect(kinds([position({ inRangeNow: false })])).toEqual(["subscribed-out-of-range"]);
  });

  it("flags open positions that aren't subscribed, and says when the registry won't accept them", () => {
    expect(kinds([position({ subscribed: false })])).toEqual(["not-subscribed"]);
    expect(kinds([position({ subscribed: false, registry: { isInRange: true, belowThreshold: false, eligible: false } })])).toEqual(["not-eligible"]);
  });

  it("flags positions below the minimum, removed by the registry, empty but subscribed, or outside the program", () => {
    expect(kinds([position({ registry: { isInRange: true, belowThreshold: true, eligible: true } })])).toEqual(["below-threshold"]);
    expect(
      kinds([position({ status: "unknown", subscriptions: [{ kind: "unsubscribed", t: 1, block: 1, txHash: "0x1", how: "registry" }] })]),
    ).toEqual(["removed-by-registry"]);
    expect(kinds([position({ status: "empty" })])).toEqual(["empty-still-subscribed"]);
    expect(kinds([position({ merklPool: false, subscribed: null, registry: null })])).toEqual(["old-program-pool"]);
  });

  it("flags a position that spent much of its subscribed time out of range, even when in range now", () => {
    const range = {
      from: 0,
      to: 100,
      activeSeconds: 100,
      inRangeSeconds: 60,
      outOfRangeSeconds: 40,
      unknownSeconds: 0,
      subscribedSeconds: 100,
      subscribedOutOfRangeSeconds: 40,
      spans: [],
      spansTruncated: false,
    };
    const [flag] = walletFlags([position({ range })]);
    expect(flag.kind).toBe("mostly-out-of-range");
    expect(flag.message).toContain("40%");
  });

  it("puts the most actionable flags first", () => {
    expect(kinds([position({ tokenId: "1", status: "empty" }), position({ tokenId: "2", inRangeNow: false })])).toEqual([
      "subscribed-out-of-range",
      "empty-still-subscribed",
    ]);
  });
});
