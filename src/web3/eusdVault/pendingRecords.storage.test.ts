import type { Address, Hash } from "viem";
import { VAULT_DEPLOYMENTS } from "./deployments";
import {
  PENDING_TTL_MS,
  clearPendingRecord,
  createPendingStorage,
  pendingStorageKey,
  readPendingRecord,
  serializePendingRecord,
  writePendingRecord,
} from "./pendingRecords";
import type { PendingContext, PendingSwapRecord, VaultPendingRecord } from "./types";

const polygon = VAULT_DEPLOYMENTS[137];
const address: Address = "0x5555555555555555555555555555555555555555";

const record: PendingSwapRecord = {
  version: 1,
  hash: `0x${"ab".repeat(32)}` as Hash,
  kind: "swap",
  direction: "usdcToEusd",
  amountIn: 1_000_000n,
  quotedOut: 999_000n,
  quotedFee: 1_000n,
  chainId: 137,
  address,
  connectorId: "walletConnect",
  smartAccount: false,
  submittedAt: 1_000,
  expiresAt: 1_000 + PENDING_TTL_MS.eoa,
  vault: polygon.vault,
  tokenIn: polygon.gem,
  tokenOut: polygon.stable,
};

const context: PendingContext = { chainId: 137, address, connectorId: "walletConnect" };
const key = pendingStorageKey(context);

/** What the browser delivers to this tab when another tab changes localStorage. */
function otherTabChanged(changedKey: string | null, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent("storage", { key: changedKey, newValue }));
}

function throwing(name: string): () => never {
  return () => {
    throw new DOMException("Storage is unavailable", name);
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("createPendingStorage with localStorage", () => {
  it("reads, writes and removes through window.localStorage", () => {
    const storage = createPendingStorage();
    storage.set("k", "v");
    expect(window.localStorage.getItem("k")).toBe("v");
    expect(storage.get("k")).toBe("v");
    storage.remove("k");
    expect(window.localStorage.getItem("k")).toBeNull();
    expect(storage.get("k")).toBeNull();
  });

  it("keeps a record for the next page load", () => {
    expect(writePendingRecord(createPendingStorage(), record, undefined)).toBe(true);
    expect(readPendingRecord(createPendingStorage(), context)).toEqual(record);
  });
});

describe("cross-tab storage events", () => {
  it("notifies only for its own key and for a clear-all", () => {
    const listener = jest.fn();
    const unsubscribe = createPendingStorage().subscribe(key, listener);

    otherTabChanged(pendingStorageKey({ ...context, connectorId: "injected" }), "x");
    expect(listener).not.toHaveBeenCalled();
    otherTabChanged(key, "x");
    expect(listener).toHaveBeenCalledTimes(1);
    otherTabChanged(null, null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    otherTabChanged(key, "y");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("lets this tab follow a record another tab writes and then clears", () => {
    const storage = createPendingStorage();
    const seen: Array<VaultPendingRecord | undefined> = [];
    const unsubscribe = storage.subscribe(key, () => seen.push(readPendingRecord(storage, context)));

    const raw = serializePendingRecord(record);
    window.localStorage.setItem(key, raw);
    otherTabChanged(key, raw);
    window.localStorage.removeItem(key);
    otherTabChanged(key, null);

    expect(seen).toEqual([record, undefined]);
    unsubscribe();
  });

  it("refuses this tab's write once another tab's live record has arrived", () => {
    const storage = createPendingStorage();
    const other = { ...record, hash: `0x${"cd".repeat(32)}` as Hash };
    window.localStorage.setItem(key, serializePendingRecord(other));
    otherTabChanged(key, serializePendingRecord(other));

    expect(writePendingRecord(storage, record, undefined, record.submittedAt + 1)).toBe(false);
    expect(readPendingRecord(storage, context)).toEqual(other);
  });
});

describe("storage that throws", () => {
  it("drops a write when storage is full", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(throwing("QuotaExceededError"));
    const storage = createPendingStorage();
    expect(() => storage.set(key, "v")).not.toThrow();
    expect(storage.get(key)).toBeNull();
    expect(writePendingRecord(storage, record, undefined)).toBe(true);
    expect(readPendingRecord(storage, context)).toBeUndefined();
  });

  it("reads null when reading throws", () => {
    window.localStorage.setItem(key, serializePendingRecord(record));
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(throwing("SecurityError"));
    const storage = createPendingStorage();
    expect(storage.get(key)).toBeNull();
    expect(readPendingRecord(storage, context)).toBeUndefined();
  });

  it("swallows a failing remove", () => {
    window.localStorage.setItem(key, serializePendingRecord(record));
    const removeItem = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(throwing("SecurityError"));
    expect(() => clearPendingRecord(createPendingStorage(), context)).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith(key);
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });

  it("fails soft when window.localStorage itself throws, and recovers when it works again", () => {
    const blocked = jest.spyOn(window, "localStorage", "get").mockImplementation(throwing("SecurityError"));
    const storage = createPendingStorage();

    expect(() => storage.set(key, "v")).not.toThrow();
    expect(storage.get(key)).toBeNull();
    expect(() => storage.remove(key)).not.toThrow();
    expect(writePendingRecord(storage, record, undefined)).toBe(true);
    expect(readPendingRecord(storage, context)).toBeUndefined();
    expect(() => clearPendingRecord(storage, context, record.hash)).not.toThrow();

    const listener = jest.fn();
    const unsubscribe = storage.subscribe(key, listener);
    otherTabChanged(key, null);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();

    blocked.mockRestore();
    expect(writePendingRecord(storage, record, undefined)).toBe(true);
    expect(readPendingRecord(storage, context)).toEqual(record);
  });
});
