import { fetchSwapPrices, formatValueChange, usdValue, valueChangeLevel, valueChangePct } from "./usd";

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const answer = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("fetchSwapPrices", () => {
  it("asks our route once per distinct token and keeps only positive numbers", async () => {
    const fetchImpl = jest.fn(async () => answer({ prices: { [TEL.toLowerCase()]: 0.002, other: "1", zero: 0 } }));
    expect(await fetchSwapPrices("polygon", [TEL, TEL.toLowerCase()], fetchImpl as unknown as typeof fetch)).toEqual({ [TEL.toLowerCase()]: 0.002 });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/swap/prices?chain=polygon&tokens=${TEL.toLowerCase()}`);
  });

  it.each([
    ["an error answer", async () => answer({ error: "x", prices: {} }, 502)],
    [
      "a network failure",
      async () => {
        throw new Error("offline");
      },
    ],
    ["a body that isn't JSON", async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error("bad")) })],
  ])("gives no prices after %s", async (_, impl) => {
    expect(await fetchSwapPrices("polygon", [TEL], impl as unknown as typeof fetch)).toEqual({});
  });
});

describe("value figures", () => {
  it("values base units at a price, and nothing without one", () => {
    expect(usdValue(5_000_000n, 6, 0.9971)).toBeCloseTo(4.9855);
    expect(usdValue(5_000_000n, 6, undefined)).toBeNull();
  });

  it("compares the value received with the value sold", () => {
    expect(valueChangePct(100, 99.58)).toBeCloseTo(-0.42);
    expect(valueChangePct(100, null)).toBeNull();
    expect(valueChangePct(0, 5)).toBeNull();
  });

  it.each([
    [null, "ok"],
    [0.5, "ok"],
    [-1, "ok"],
    [-1.01, "warn"],
    [-5, "warn"],
    [-5.01, "high"],
  ] as const)("flags %p as %s", (pct, level) => {
    expect(valueChangeLevel(pct)).toBe(level);
  });

  it.each([
    [-0.4213, "-0.42%"],
    [0.123, "+0.12%"],
    [0.001, "0.00%"],
    [-6.5, "-6.50%"],
  ])("formats %p as %s", (pct, label) => {
    expect(formatValueChange(pct)).toBe(label);
  });
});
