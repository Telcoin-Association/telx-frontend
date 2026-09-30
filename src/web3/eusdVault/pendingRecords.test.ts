/** @jest-environment node */
import { getAddress, type Address, type Hash, type Hex } from "viem";
import { VAULT_DEPLOYMENTS } from "./deployments";
import {
  PENDING_TTL_MS,
  clearPendingRecord,
  createPendingStorage,
  findPendingElsewhere,
  isPendingExpired,
  isSmartAccount,
  parsePendingRecord,
  pendingDeadline,
  pendingStorageKey,
  pendingTtlMs,
  readPendingRecord,
  serializePendingRecord,
  shouldClearPending,
  writePendingRecord,
} from "./pendingRecords";
import type {
  PendingApproveRecord,
  PendingContext,
  PendingStorage,
  PendingSwapRecord,
  VaultLiveState,
  VaultPendingRecord,
} from "./types";

const polygon = VAULT_DEPLOYMENTS[137];
const base = VAULT_DEPLOYMENTS[8453];
const address: Address = "0x5555555555555555555555555555555555555555";
const stranger: Address = "0x6666666666666666666666666666666666666666";
const hash = `0x${"ab".repeat(32)}` as Hash;
const otherHash = `0x${"cd".repeat(32)}` as Hash;

const approve: PendingApproveRecord = {
  version: 1,
  hash,
  kind: "approve",
  direction: "usdcToEusd",
  amountIn: 1_000_000n,
  chainId: 137,
  address,
  connectorId: "injected",
  smartAccount: false,
  submittedAt: 1_000,
  expiresAt: 1_000 + PENDING_TTL_MS.eoa,
  vault: polygon.vault,
  tokenIn: polygon.gem,
  tokenOut: polygon.stable,
};

const swap: PendingSwapRecord = { ...approve, kind: "swap", quotedOut: 999_000n, quotedFee: 1_000n };

const sellEusd: PendingApproveRecord = {
  ...approve,
  direction: "eusdToUsdc",
  tokenIn: polygon.stable,
  tokenOut: polygon.gem,
};

const context: PendingContext = { chainId: approve.chainId, address, connectorId: approve.connectorId };

function memoryStorage(): PendingStorage {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    subscribe: () => () => {},
  };
}

/** The serialised record with some fields replaced or, with `undefined`, dropped. */
function tamper(r: VaultPendingRecord, patch: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(serializePendingRecord(r)), ...patch });
}

describe("pendingStorageKey", () => {
  it("normalises the address so checksummed and lowercase forms share a key", () => {
    const checksummed = pendingStorageKey({
      chainId: 1,
      address: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
      connectorId: "safe",
    });
    const lower = pendingStorageKey({
      chainId: 1,
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
      connectorId: "safe",
    });
    expect(checksummed).toBe(lower);
    expect(lower).toBe("eusd-vault.pending.v1:1:0xabcdef0123456789abcdef0123456789abcdef01:safe");
  });

  it("keeps one record per chain, address and connector", () => {
    const keys = new Set([
      pendingStorageKey(context),
      pendingStorageKey({ ...context, chainId: 8453 }),
      pendingStorageKey({ ...context, address: stranger }),
      pendingStorageKey({ ...context, connectorId: "walletConnect" }),
    ]);
    expect(keys.size).toBe(4);
    expect(pendingStorageKey(approve)).toBe(pendingStorageKey(context));
  });
});

describe("TTL", () => {
  it("is 30 minutes for an EOA and 7 days for a smart account", () => {
    expect(PENDING_TTL_MS).toEqual({ eoa: 30 * 60_000, smartAccount: 7 * 24 * 60 * 60_000 });
    expect(Object.isFrozen(PENDING_TTL_MS)).toBe(true);
    expect(pendingTtlMs(false)).toBe(30 * 60_000);
    expect(pendingTtlMs(true)).toBe(7 * 24 * 60 * 60_000);
  });

  it("lets smartAccount drive how long a record stays live", () => {
    const build = (smartAccount: boolean): VaultPendingRecord => ({
      ...approve,
      smartAccount,
      expiresAt: approve.submittedAt + pendingTtlMs(smartAccount),
    });
    const hourLater = approve.submittedAt + 60 * 60_000;
    expect(isPendingExpired(build(false), hourLater)).toBe(true);
    expect(isPendingExpired(build(true), hourLater)).toBe(false);
    expect(isPendingExpired(build(true), approve.submittedAt + PENDING_TTL_MS.smartAccount)).toBe(true);
  });

  it("expires at expiresAt", () => {
    expect(isPendingExpired(approve, approve.expiresAt - 1)).toBe(false);
    expect(isPendingExpired(approve, approve.expiresAt)).toBe(true);
    expect(pendingDeadline(approve)).toBe(approve.expiresAt);
  });

  it("keeps a stored expiry that is earlier than the TTL", () => {
    const early = { ...approve, expiresAt: approve.submittedAt + 60_000 };
    expect(pendingDeadline(early)).toBe(early.expiresAt);
    expect(isPendingExpired(early, early.expiresAt)).toBe(true);
  });

  it.each([false, true])("caps a stored expiry beyond the TTL at the TTL (smart account %s)", (smartAccount) => {
    const ttl = pendingTtlMs(smartAccount);
    const stored = parsePendingRecord(tamper({ ...swap, smartAccount }, { expiresAt: 1e15 }));
    expect(stored?.expiresAt).toBe(1e15);
    if (!stored) return;

    expect(pendingDeadline(stored)).toBe(stored.submittedAt + ttl);
    expect(isPendingExpired(stored, stored.submittedAt + ttl - 1)).toBe(false);
    expect(isPendingExpired(stored, stored.submittedAt + ttl)).toBe(true);
    expect(isPendingExpired(stored, stored.submittedAt + 365 * 24 * 60 * 60_000)).toBe(true);
  });

  it.each([false, true])("expires a record stamped more than a TTL ahead (smart account %s)", (smartAccount) => {
    const ttl = pendingTtlMs(smartAccount);
    const now = 5_000_000_000;
    const ahead = (by: number): VaultPendingRecord => ({
      ...approve,
      smartAccount,
      submittedAt: now + by,
      expiresAt: now + by + ttl,
    });
    // A clock a little fast holds the record at most one TTL longer than it should.
    expect(isPendingExpired(ahead(ttl), now)).toBe(false);
    expect(isPendingExpired(ahead(ttl + 1), now)).toBe(true);
  });
});

describe("serialize and parse", () => {
  it("round trips a swap record with its quote through decimal strings", () => {
    const raw = serializePendingRecord(swap);
    const json = JSON.parse(raw);
    expect(json.amountIn).toBe("1000000");
    expect(json.quotedOut).toBe("999000");
    expect(json.quotedFee).toBe("1000");
    expect(parsePendingRecord(raw)).toEqual(swap);
  });

  it("round trips an approve record without quote fields", () => {
    const raw = serializePendingRecord(approve);
    expect(JSON.parse(raw)).not.toHaveProperty("quotedOut");
    expect(JSON.parse(raw)).not.toHaveProperty("quotedFee");
    const parsed = parsePendingRecord(raw);
    expect(parsed).toEqual(approve);
    expect(parsed && "quotedOut" in parsed).toBe(false);
    expect(parsed && "quotedFee" in parsed).toBe(false);
  });

  it("round trips both directions and a smart account", () => {
    expect(parsePendingRecord(serializePendingRecord(sellEusd))).toEqual(sellEusd);
    const safe: VaultPendingRecord = { ...swap, smartAccount: true, connectorId: "safe" };
    expect(parsePendingRecord(serializePendingRecord(safe))).toEqual(safe);
  });

  it("round trips a record on every vault chain", () => {
    for (const d of Object.values(VAULT_DEPLOYMENTS)) {
      const r: VaultPendingRecord = { ...approve, chainId: d.chainId, vault: d.vault, tokenIn: d.gem, tokenOut: d.stable };
      expect(parsePendingRecord(serializePendingRecord(r))).toEqual(r);
    }
  });

  it("accepts the pinned addresses in lowercase and returns them checksummed", () => {
    const raw = tamper(swap, {
      vault: polygon.vault.toLowerCase(),
      tokenIn: polygon.gem.toLowerCase(),
      tokenOut: polygon.stable.toLowerCase(),
    });
    expect(parsePendingRecord(raw)).toEqual(swap);
  });

  it("ignores fields it does not know", () => {
    expect(parsePendingRecord(tamper(approve, { note: "hello" }))).toEqual(approve);
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["corrupt JSON", "{not json"],
    ["JSON null", "null"],
    ["a number", "42"],
    ["an array", "[]"],
    ["wrong version", tamper(approve, { version: 2 })],
    ["string version", tamper(approve, { version: "1" })],
    ["missing version", tamper(approve, { version: undefined })],
    ["missing hash", tamper(approve, { hash: undefined })],
    ["bad hash", tamper(approve, { hash: "0x1234" })],
    ["bad address", tamper(approve, { address: "not-an-address" })],
    ["badly checksummed address", tamper(approve, { address: "0xAbCdEf0123456789abcdef0123456789abcdef01" })],
    ["missing amount", tamper(approve, { amountIn: undefined })],
    ["numeric amount", tamper(approve, { amountIn: 1_000_000 })],
    ["exponent amount", tamper(approve, { amountIn: "1e6" })],
    ["negative amount", tamper(approve, { amountIn: "-1" })],
    ["fractional amount", tamper(approve, { amountIn: "1.5" })],
    ["non-numeric timestamp", tamper(approve, { submittedAt: "soon" })],
    ["missing expiry", tamper(approve, { expiresAt: undefined })],
    ["unknown kind", tamper(approve, { kind: "burn" })],
    ["a migrate kind", tamper(approve, { kind: "migrate" })],
    ["missing kind", tamper(approve, { kind: undefined })],
    ["unknown direction", tamper(approve, { direction: "usdcToUsdt" })],
    ["missing direction", tamper(approve, { direction: undefined })],
    ["empty connector", tamper(approve, { connectorId: "" })],
    ["missing smartAccount", tamper(approve, { smartAccount: undefined })],
    ["string smartAccount", tamper(approve, { smartAccount: "false" })],
    ["a chain without a vault", tamper(approve, { chainId: 10 })],
    ["the Sepolia chain", tamper(approve, { chainId: 11155111 })],
    ["a string chain id", tamper(approve, { chainId: "137" })],
    ["a fractional chain id", tamper(approve, { chainId: 137.5 })],
  ])("returns undefined for %s", (_label, raw) => {
    expect(parsePendingRecord(raw)).toBeUndefined();
  });

  it.each([
    ["without quotedOut", { quotedOut: undefined }],
    ["without quotedFee", { quotedFee: undefined }],
    ["without either quote field", { quotedOut: undefined, quotedFee: undefined }],
    ["with a numeric quotedOut", { quotedOut: 999_000 }],
    ["with a non-numeric quotedFee", { quotedFee: "abc" }],
  ])("rejects a swap record %s", (_label, patch) => {
    expect(parsePendingRecord(tamper(swap, patch))).toBeUndefined();
  });

  it.each([
    ["quotedOut", { quotedOut: "999000" }],
    ["quotedFee", { quotedFee: "1000" }],
    ["both quote fields", { quotedOut: "999000", quotedFee: "1000" }],
    ["a null quotedOut", { quotedOut: null }],
  ])("rejects an approve record carrying %s", (_label, patch) => {
    expect(parsePendingRecord(tamper(approve, patch))).toBeUndefined();
  });

  describe("pinned deployment", () => {
    it.each([
      ["another vault", { vault: stranger }],
      ["another input token", { tokenIn: stranger }],
      ["another output token", { tokenOut: stranger }],
      ["the other direction's tokens", { tokenIn: polygon.stable, tokenOut: polygon.gem }],
      ["the same token in and out", { tokenOut: polygon.gem }],
      ["bridged USDC.e", { tokenIn: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" }],
      ["another chain's USDC", { tokenIn: base.gem }],
      ["the multicall as vault", { vault: polygon.multicall3 }],
    ])("rejects a record naming %s", (_label, patch) => {
      expect(parsePendingRecord(tamper(approve, patch))).toBeUndefined();
      expect(parsePendingRecord(tamper(swap, patch))).toBeUndefined();
    });

    it("rejects a direction that does not match the record's tokens", () => {
      expect(parsePendingRecord(tamper(approve, { direction: "eusdToUsdc" }))).toBeUndefined();
      expect(parsePendingRecord(tamper(sellEusd, { direction: "usdcToEusd" }))).toBeUndefined();
    });

    it("rejects a Polygon record relabelled as another chain", () => {
      expect(parsePendingRecord(tamper(approve, { chainId: 8453 }))).toBeUndefined();
      expect(parsePendingRecord(tamper(approve, { chainId: 1 }))).toBeUndefined();
    });
  });
});

describe("readPendingRecord", () => {
  it("returns the stored record", () => {
    const storage = memoryStorage();
    storage.set(pendingStorageKey(swap), serializePendingRecord(swap));
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("returns undefined for an empty slot", () => {
    expect(readPendingRecord(memoryStorage(), context)).toBeUndefined();
  });

  it("matches the context's address in any letter case", () => {
    const mixed = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");
    const r: VaultPendingRecord = { ...approve, address: mixed };
    const storage = memoryStorage();
    storage.set(pendingStorageKey(r), serializePendingRecord(r));
    expect(readPendingRecord(storage, { ...context, address: mixed.toLowerCase() as Address })).toEqual(r);
  });

  it("removes a corrupt entry", () => {
    const storage = memoryStorage();
    const key = pendingStorageKey(context);
    storage.set(key, "{corrupt");
    expect(readPendingRecord(storage, context)).toBeUndefined();
    expect(storage.get(key)).toBeNull();
  });

  it("removes a record naming contracts other than the pinned ones", () => {
    const storage = memoryStorage();
    const key = pendingStorageKey(context);
    storage.set(key, tamper(approve, { vault: stranger }));
    expect(readPendingRecord(storage, context)).toBeUndefined();
    expect(storage.get(key)).toBeNull();
  });

  it.each<[string, VaultPendingRecord]>([
    ["another wallet's", { ...approve, address: stranger }],
    ["another connector's", { ...approve, connectorId: "walletConnect" }],
    ["another chain's", { ...approve, chainId: 8453, vault: base.vault, tokenIn: base.gem, tokenOut: base.stable }],
  ])("removes %s record stored under this context's key", (_label, foreign) => {
    const storage = memoryStorage();
    const key = pendingStorageKey(context);
    storage.set(key, serializePendingRecord(foreign));
    expect(readPendingRecord(storage, context)).toBeUndefined();
    expect(storage.get(key)).toBeNull();
  });
});

describe("writePendingRecord", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes when the slot is empty and nothing was expected", () => {
    const storage = memoryStorage();
    expect(writePendingRecord(storage, swap, undefined)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("refuses when another tab stored a different live hash first", () => {
    const storage = memoryStorage();
    const other = { ...approve, hash: otherHash };
    storage.set(pendingStorageKey(context), serializePendingRecord(other));
    expect(writePendingRecord(storage, swap, undefined, approve.submittedAt + 1)).toBe(false);
    expect(readPendingRecord(storage, context)).toEqual(other);
  });

  it("refuses when the live record is not the one expected", () => {
    const storage = memoryStorage();
    const other = { ...approve, hash: otherHash };
    storage.set(pendingStorageKey(context), serializePendingRecord(other));
    const third = `0x${"ef".repeat(32)}` as Hash;
    expect(writePendingRecord(storage, swap, third, approve.submittedAt + 1)).toBe(false);
    expect(readPendingRecord(storage, context)).toEqual(other);
  });

  it("writes into an empty slot even when another hash was expected", () => {
    const storage = memoryStorage();
    expect(writePendingRecord(storage, swap, otherHash, approve.submittedAt + 1)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("replaces an expired record from another tab", () => {
    const storage = memoryStorage();
    const other = { ...approve, hash: otherHash };
    storage.set(pendingStorageKey(context), serializePendingRecord(other));
    expect(writePendingRecord(storage, swap, undefined, other.expiresAt)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("replaces the record whose hash was expected", () => {
    const storage = memoryStorage();
    const approval = { ...approve, hash: otherHash };
    storage.set(pendingStorageKey(context), serializePendingRecord(approval));
    expect(writePendingRecord(storage, swap, otherHash, approve.submittedAt + 1)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("compares hashes without regard to letter case", () => {
    const storage = memoryStorage();
    storage.set(pendingStorageKey(context), serializePendingRecord({ ...approve, hash: otherHash }));
    const upper = `0x${otherHash.slice(2).toUpperCase()}` as Hash;
    expect(writePendingRecord(storage, swap, upper, approve.submittedAt + 1)).toBe(true);
  });

  it("replaces an unparseable or foreign entry", () => {
    const storage = memoryStorage();
    const key = pendingStorageKey(context);
    storage.set(key, "{corrupt");
    expect(writePendingRecord(storage, swap, undefined, approve.submittedAt + 1)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);

    storage.set(key, serializePendingRecord({ ...approve, hash: otherHash, address: stranger }));
    expect(writePendingRecord(storage, swap, undefined, approve.submittedAt + 1)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("uses Date.now() when no time is given", () => {
    const storage = memoryStorage();
    const other = { ...approve, hash: otherHash };
    storage.set(pendingStorageKey(context), serializePendingRecord(other));

    jest.spyOn(Date, "now").mockReturnValue(other.expiresAt - 1);
    expect(writePendingRecord(storage, swap, undefined)).toBe(false);
    jest.spyOn(Date, "now").mockReturnValue(other.expiresAt);
    expect(writePendingRecord(storage, swap, undefined)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });

  it("reports a lost race when another tab writes between this write and its read-back", () => {
    const inner = memoryStorage();
    const other = serializePendingRecord({ ...approve, hash: otherHash });
    const racing: PendingStorage = {
      ...inner,
      set: (k, v) => {
        inner.set(k, v);
        inner.set(k, other);
      },
    };
    expect(writePendingRecord(racing, swap, undefined, approve.submittedAt + 1)).toBe(false);
    expect(inner.get(pendingStorageKey(context))).toBe(other);
  });

  it("reports success when storage drops the write", () => {
    const dropping: PendingStorage = { ...memoryStorage(), set: () => {} };
    expect(writePendingRecord(dropping, swap, undefined)).toBe(true);
  });
});

describe("findPendingElsewhere", () => {
  const chainIds = [1, 137, 8453] as const;
  const onBase: PendingContext = { ...context, chainId: 8453 };
  const now = approve.submittedAt + 1;

  function stored(...records: Array<[key: string, value: string]>): PendingStorage {
    const storage = memoryStorage();
    for (const [key, value] of records) storage.set(key, value);
    return storage;
  }

  it("finds this wallet's live record on another network", () => {
    const storage = stored([pendingStorageKey(swap), serializePendingRecord(swap)]);
    expect(findPendingElsewhere(storage, onBase, chainIds, now)).toBe(137);
  });

  it("returns the first network in the given order", () => {
    const ethereum = VAULT_DEPLOYMENTS[1];
    const onEthereum: VaultPendingRecord = {
      ...approve,
      chainId: 1,
      vault: ethereum.vault,
      tokenIn: ethereum.gem,
      tokenOut: ethereum.stable,
    };
    const storage = stored(
      [pendingStorageKey(swap), serializePendingRecord(swap)],
      [pendingStorageKey(onEthereum), serializePendingRecord(onEthereum)]
    );
    expect(findPendingElsewhere(storage, onBase, chainIds, now)).toBe(1);
    expect(findPendingElsewhere(storage, onBase, [137, 1], now)).toBe(137);
  });

  it("ignores an expired record", () => {
    const storage = stored([pendingStorageKey(swap), serializePendingRecord(swap)]);
    expect(findPendingElsewhere(storage, onBase, chainIds, pendingDeadline(swap))).toBeUndefined();
  });

  it("finds nothing in empty storage", () => {
    expect(findPendingElsewhere(memoryStorage(), onBase, chainIds, now)).toBeUndefined();
  });

  it("ignores the context's own network", () => {
    const storage = stored([pendingStorageKey(swap), serializePendingRecord(swap)]);
    expect(findPendingElsewhere(storage, context, chainIds, now)).toBeUndefined();
  });

  it("ignores another connector's record for the same wallet", () => {
    const other: VaultPendingRecord = { ...swap, connectorId: "walletConnect" };
    const storage = stored([pendingStorageKey(other), serializePendingRecord(other)]);
    expect(findPendingElsewhere(storage, onBase, chainIds, now)).toBeUndefined();
  });

  it.each<[string, string]>([
    ["another wallet's record", serializePendingRecord({ ...swap, address: stranger })],
    ["a corrupt entry", "{corrupt"],
    ["a record naming other contracts", tamper(swap, { vault: stranger })],
  ])("ignores %s in another network's slot and leaves it in place", (_label, value) => {
    const key = pendingStorageKey({ ...onBase, chainId: 137 });
    const storage = stored([key, value]);
    expect(findPendingElsewhere(storage, onBase, chainIds, now)).toBeUndefined();
    expect(storage.get(key)).toBe(value);
  });

  it("never writes or removes anything", () => {
    const storage = stored([pendingStorageKey(swap), serializePendingRecord(swap)]);
    const set = jest.spyOn(storage, "set");
    const remove = jest.spyOn(storage, "remove");
    findPendingElsewhere(storage, onBase, chainIds, now);
    findPendingElsewhere(storage, onBase, chainIds, pendingDeadline(swap));
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(readPendingRecord(storage, context)).toEqual(swap);
  });
});

describe("clearPendingRecord", () => {
  it("clears unconditionally without a hash", () => {
    const storage = memoryStorage();
    storage.set(pendingStorageKey(context), serializePendingRecord(approve));
    clearPendingRecord(storage, context);
    expect(storage.get(pendingStorageKey(context))).toBeNull();
  });

  it("keeps a newer record from another tab when a hash is given", () => {
    const storage = memoryStorage();
    const newer = { ...swap, hash: otherHash };
    storage.set(pendingStorageKey(context), serializePendingRecord(newer));
    clearPendingRecord(storage, context, hash);
    expect(readPendingRecord(storage, context)).toEqual(newer);
    clearPendingRecord(storage, context, otherHash);
    expect(storage.get(pendingStorageKey(context))).toBeNull();
  });

  it("removes an unparseable entry even when a hash is given", () => {
    const storage = memoryStorage();
    storage.set(pendingStorageKey(context), "{corrupt");
    clearPendingRecord(storage, context, hash);
    expect(storage.get(pendingStorageKey(context))).toBeNull();
  });

  it("does nothing to an empty slot", () => {
    const storage = memoryStorage();
    expect(() => clearPendingRecord(storage, context, hash)).not.toThrow();
    expect(storage.get(pendingStorageKey(context))).toBeNull();
  });
});

describe("shouldClearPending", () => {
  const after = approve.submittedAt + 1;
  const covering = { value: approve.amountIn, updatedAt: after };

  it.each<[string, VaultLiveState]>([
    ["no live state", { allowances: {} }],
    ["a fresh allowance covering it", { allowances: { usdcToEusd: covering } }],
    ["fresh allowances on both tokens", { allowances: { usdcToEusd: covering, eusdToUsdc: covering } }],
    ["a huge fresh allowance", { allowances: { usdcToEusd: { value: 2n ** 256n - 1n, updatedAt: after } } }],
  ])("never clears a swap record, given %s", (_label, live) => {
    expect(shouldClearPending(swap, live)).toBe(false);
    expect(shouldClearPending({ ...swap, direction: "eusdToUsdc" }, live)).toBe(false);
  });

  it("clears an approve record once a fresh allowance for its own token covers the amount", () => {
    expect(shouldClearPending(approve, { allowances: { usdcToEusd: covering } })).toBe(true);
    expect(
      shouldClearPending(approve, { allowances: { usdcToEusd: { value: approve.amountIn + 1n, updatedAt: after } } })
    ).toBe(true);
    expect(shouldClearPending(sellEusd, { allowances: { eusdToUsdc: covering } })).toBe(true);
  });

  it.each<[string, VaultLiveState]>([
    ["no live state", { allowances: {} }],
    ["a short allowance", { allowances: { usdcToEusd: { value: approve.amountIn - 1n, updatedAt: after } } }],
    ["an allowance read at submission", { allowances: { usdcToEusd: { ...covering, updatedAt: approve.submittedAt } } }],
    ["an allowance read before submission", { allowances: { usdcToEusd: { ...covering, updatedAt: 0 } } }],
    ["an allowance without a timestamp", { allowances: { usdcToEusd: { value: approve.amountIn } } }],
    ["a timestamp without a value", { allowances: { usdcToEusd: { updatedAt: after } } }],
    ["the other token's fresh allowance", { allowances: { eusdToUsdc: covering } }],
    [
      "the other token's fresh allowance beside a stale own one",
      { allowances: { usdcToEusd: { ...covering, updatedAt: 0 }, eusdToUsdc: covering } },
    ],
  ])("keeps an approve record given %s", (_label, live) => {
    expect(shouldClearPending(approve, live)).toBe(false);
  });

  it("keeps an eUSD approve record given only the USDC allowance", () => {
    expect(shouldClearPending(sellEusd, { allowances: { usdcToEusd: covering } })).toBe(false);
  });
});

describe("isSmartAccount", () => {
  const delegate = "1234567890abcdef1234567890abcdef12345678";

  it.each<[string, string, Hex | undefined]>([
    ["the Safe connector without code", "safe", undefined],
    ["the Safe connector with a 7702 delegation", "safe", `0xef0100${delegate}`],
    ["contract code", "walletConnect", "0x608060405234801561001057600080fd5b50"],
    [
      "a minimal proxy",
      "injected",
      "0x363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3",
    ],
    ["a 22-byte code starting with the 7702 prefix", "injected", `0xef0100${delegate.slice(2)}`],
    ["a 24-byte code starting with the 7702 prefix", "injected", `0xef0100${delegate}ff`],
    ["the 7702 prefix alone", "injected", "0xef0100"],
    ["a 23-byte code with another prefix", "injected", `0xef0200${delegate}`],
  ])("treats %s as a smart account", (_label, connectorId, code) => {
    expect(isSmartAccount(connectorId, code)).toBe(true);
  });

  it.each<[string, string, Hex | undefined]>([
    ["a 7702 delegation in lowercase", "injected", `0xef0100${delegate}`],
    ["a 7702 delegation in uppercase", "walletConnect", `0xEF0100${delegate.toUpperCase()}`],
    ["no code", "injected", undefined],
    ["empty code", "metaMaskSDK", "0x"],
  ])("treats %s as an EOA", (_label, connectorId, code) => {
    expect(isSmartAccount(connectorId, code)).toBe(false);
  });
});

describe("createPendingStorage without a window", () => {
  it("reads null, drops writes and never throws", () => {
    const storage = createPendingStorage();
    expect(() => storage.set("k", "v")).not.toThrow();
    expect(storage.get("k")).toBeNull();
    expect(() => storage.remove("k")).not.toThrow();
    const unsubscribe = storage.subscribe("k", () => {});
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("lets a write report success and a read find nothing", () => {
    const storage = createPendingStorage();
    expect(writePendingRecord(storage, swap, undefined)).toBe(true);
    expect(readPendingRecord(storage, context)).toBeUndefined();
  });
});
