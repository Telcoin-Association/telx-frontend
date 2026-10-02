/**
 * @jest-environment node
 */
import { fetchQuote, isQuoteFresh, parseSellAmount, QUOTE_TTL_MS } from "./quote";

const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const request = { chain: "polygon" as const, sellToken: USDC as `0x${string}`, buyToken: TEL as `0x${string}`, sellAmount: 5_000_000n, taker: undefined, slippageBps: 50 };
const respond = (status: number, body: unknown) => jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("parseSellAmount", () => {
  it("reads a decimal amount in base units", () => {
    expect(parseSellAmount("5", 6)).toBe(5_000_000n);
    expect(parseSellAmount("0.25", 6)).toBe(250_000n);
    expect(parseSellAmount(".5", 18)).toBe(500_000_000_000_000_000n);
  });

  it("rejects empty, zero, malformed and over-precise amounts", () => {
    for (const text of ["", ".", "0", "0.000", "1e3", "-1", "abc", "1.1234567"]) expect(parseSellAmount(text, 6)).toBeNull();
  });
});

describe("isQuoteFresh", () => {
  it("is fresh until QUOTE_TTL_MS has passed", () => {
    expect(isQuoteFresh(1_000, 1_000 + QUOTE_TTL_MS - 1)).toBe(true);
    expect(isQuoteFresh(1_000, 1_000 + QUOTE_TTL_MS)).toBe(false);
  });
});

describe("fetchQuote", () => {
  it("asks our route for an indicative price without a taker, and a firm quote with one", async () => {
    const fetchImpl = respond(200, { liquidityAvailable: true, buyAmount: "1" });
    await fetchQuote(request, fetchImpl as unknown as typeof fetch);
    await fetchQuote({ ...request, taker: "0x00000000000000000000000000000000000000aa" }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe(`/api/swap/quote?chain=polygon&sellToken=${USDC}&buyToken=${TEL}&sellAmount=5000000&slippageBps=50`);
    expect(fetchImpl.mock.calls[1][0]).toMatch(/&taker=0x0+aa$/);
  });

  it("dates a quote, and reports no liquidity, route errors, an unconfigured route and network failures", async () => {
    await expect(fetchQuote(request, respond(200, { liquidityAvailable: true, buyAmount: "1" }) as unknown as typeof fetch, () => 42)).resolves.toMatchObject({ kind: "quote", fetchedAt: 42 });
    await expect(fetchQuote(request, respond(200, { liquidityAvailable: false }) as unknown as typeof fetch)).resolves.toEqual({ kind: "no-liquidity" });
    await expect(fetchQuote(request, respond(400, { error: "0x rejected the swap: x" }) as unknown as typeof fetch)).resolves.toEqual({
      kind: "error",
      message: "0x rejected the swap: x",
      unavailable: false,
    });
    await expect(fetchQuote(request, respond(503, { error: "Swaps aren't available yet." }) as unknown as typeof fetch)).resolves.toMatchObject({ unavailable: true });
    await expect(fetchQuote(request, jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch)).resolves.toMatchObject({ kind: "error" });
  });
});
