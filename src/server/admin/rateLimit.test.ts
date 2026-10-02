/**
 * @jest-environment node
 */
import { clientKey, createRateLimit } from "./rateLimit";

describe("createRateLimit", () => {
  it("allows the limit per window and key, then refuses until the window passes", () => {
    let now = 0;
    const limit = createRateLimit({ limit: 2, windowMs: 1000, now: () => now });
    expect([limit.take("a"), limit.take("a"), limit.take("a")]).toEqual([true, true, false]);
    expect(limit.take("b")).toBe(true);
    now = 1000;
    expect(limit.take("a")).toBe(true);
  });

  it("forgets the oldest keys past its size", () => {
    const limit = createRateLimit({ limit: 1, windowMs: 1000, maxKeys: 1, now: () => 0 });
    expect(limit.take("a")).toBe(true);
    expect(limit.take("b")).toBe(true);
    expect(limit.take("a")).toBe(true);
  });
});

describe("clientKey", () => {
  it("prefers x-real-ip, then the first x-forwarded-for address", () => {
    expect(clientKey(new Request("https://x", { headers: { "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" } }))).toBe("1.1.1.1");
    expect(clientKey(new Request("https://x", { headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" } }))).toBe("2.2.2.2");
    expect(clientKey(new Request("https://x"))).toBe("unknown");
  });
});
