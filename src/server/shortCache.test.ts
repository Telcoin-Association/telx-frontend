/**
 * @jest-environment node
 */
import { createShortCache } from "./shortCache";

describe("createShortCache", () => {
  it("serves a fresh value without loading again, and reloads once it expires", async () => {
    let time = 0;
    const cache = createShortCache<number>({ ttlMs: 1_000, now: () => time });
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await expect(cache.get("k", load)).resolves.toBe(1);
    time = 999;
    await expect(cache.get("k", load)).resolves.toBe(1);
    time = 1_000;
    await expect(cache.get("k", load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const cache = createShortCache<number>({ ttlMs: 1_000 });
    let resolve!: (value: number) => void;
    const load = jest.fn(() => new Promise<number>(r => (resolve = r)));
    const both = Promise.all([cache.get("k", load), cache.get("k", load)]);
    resolve(5);
    await expect(both).resolves.toEqual([5, 5]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure", async () => {
    const cache = createShortCache<number>({ ttlMs: 1_000 });
    const load = jest.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(3);
    await expect(cache.get("k", load)).rejects.toThrow("down");
    await expect(cache.get("k", load)).resolves.toBe(3);
  });

  it("loads again when `accept` rejects the cached or in-flight value", async () => {
    const cache = createShortCache<{ block: number }>({ ttlMs: 10_000 });
    const load = jest.fn().mockResolvedValueOnce({ block: 5 }).mockResolvedValueOnce({ block: 9 });
    await cache.get("k", load);
    await expect(cache.get("k", load, v => v.block >= 5)).resolves.toEqual({ block: 5 });
    await expect(cache.get("k", load, v => v.block >= 8)).resolves.toEqual({ block: 9 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps at most maxEntries keys, dropping the oldest", async () => {
    const cache = createShortCache<string>({ ttlMs: 10_000, maxEntries: 2 });
    const load = jest.fn(async () => "v");
    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("c", load);
    await cache.get("b", load);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
