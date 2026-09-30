/** @jest-environment node */
import type { Hash } from "viem";
import { abortError, asError, backoffMs, isAbortError, isRecord, sameHash } from "./internal";

const HASH = `0x${"ab".repeat(32)}` as Hash;
const OTHER = `0x${"cd".repeat(32)}` as Hash;

describe("isRecord", () => {
  it.each([{}, [], new Error("x"), Object.create(null)])("accepts the object %p", (value) => {
    expect(isRecord(value)).toBe(true);
  });

  it.each([null, undefined, 0, "", "text", true, 1n, Symbol("s"), () => undefined])("rejects %p", (value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe("asError", () => {
  it("returns an Error unchanged", () => {
    const error = new TypeError("boom");
    expect(asError(error)).toBe(error);
  });

  it.each([
    ["boom", "boom"],
    [42, "42"],
    [undefined, "undefined"],
    [null, "null"],
    [{ message: "not an error" }, "[object Object]"],
  ])("wraps %p in an Error", (value, message) => {
    const error = asError(value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);
  });
});

describe("abortError and isAbortError", () => {
  it("makes a DOMException named AbortError", () => {
    const error = abortError();
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("The operation was aborted.");
  });

  it("recognises its own error and any error named AbortError", () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(Object.assign(new Error("stop"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it.each([new Error("x"), new DOMException("x", "TimeoutError"), "AbortError", null, undefined])(
    "does not take %p for an abort",
    (value) => {
      expect(isAbortError(value)).toBe(false);
    }
  );
});

describe("sameHash", () => {
  it("matches equal hashes ignoring case", () => {
    expect(sameHash(HASH, HASH)).toBe(true);
    expect(sameHash(HASH, HASH.toUpperCase().replace("0X", "0x") as Hash)).toBe(true);
  });

  it("does not match different hashes", () => {
    expect(sameHash(HASH, OTHER)).toBe(false);
  });

  it("matches nothing when either hash is missing, including two missing hashes", () => {
    expect(sameHash(HASH, undefined)).toBe(false);
    expect(sameHash(undefined, HASH)).toBe(false);
    expect(sameHash(undefined, undefined)).toBe(false);
  });
});

describe("backoffMs", () => {
  const timings = { minBackoffMs: 1_000, maxBackoffMs: 15_000 };

  it("doubles from the minimum at attempt 1 up to the maximum", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((attempt) => backoffMs(attempt, timings))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ]);
  });

  it.each([0, -1])("waits the minimum for attempt %i", (attempt) => {
    expect(backoffMs(attempt, timings)).toBe(1_000);
  });
});
