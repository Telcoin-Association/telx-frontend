/**
 * @jest-environment node
 */
import { fetchUsdPrices, llamaCoinId, MAX_PRICE_TOKENS, parsePricesQuery } from "./prices";

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const EMXN = "0x68727e573D21a49c767c3c86A92D9F24bd933c99";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const answer = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("parsePricesQuery", () => {
  it("accepts a chain and up to the limit of addresses, lowercased and deduplicated", () => {
    expect(parsePricesQuery(new URLSearchParams({ chain: "polygon", tokens: `${TEL},${TEL.toLowerCase()}, ${EMXN}` }))).toEqual({
      ok: true,
      chain: "polygon",
      tokens: [TEL.toLowerCase(), EMXN.toLowerCase()],
    });
  });

  it.each([
    [{ chain: "arbitrum", tokens: TEL }, "chain must be ethereum, polygon or base"],
    [{ chain: "polygon", tokens: "" }, `tokens must be 1 to ${MAX_PRICE_TOKENS} comma-separated addresses`],
    [{ chain: "polygon", tokens: "TEL" }, `tokens must be 1 to ${MAX_PRICE_TOKENS} comma-separated addresses`],
    [
      { chain: "polygon", tokens: Array.from({ length: MAX_PRICE_TOKENS + 1 }, (_, i) => `0x${String(i).padStart(40, "0")}`).join(",") },
      `tokens must be 1 to ${MAX_PRICE_TOKENS} comma-separated addresses`,
    ],
  ])("refuses %p", (query, error) => {
    expect(parsePricesQuery(new URLSearchParams(query))).toEqual({ ok: false, error });
  });
});

describe("llamaCoinId", () => {
  it("names a token by chain and lowercase address, and the native token by the zero address", () => {
    expect(llamaCoinId("base", TEL)).toBe(`base:${TEL.toLowerCase()}`);
    expect(llamaCoinId("polygon", NATIVE)).toBe("polygon:0x0000000000000000000000000000000000000000");
  });
});

describe("fetchUsdPrices", () => {
  it("asks DefiLlama for every token and keys the prices by the address asked for", async () => {
    const fetchImpl = jest.fn(async () =>
      answer({
        coins: {
          [`polygon:${TEL}`]: { price: 0.00215, confidence: 0.99 },
          "polygon:0x0000000000000000000000000000000000000000": { price: 0.11, confidence: 0.99 },
        },
      }),
    );
    const prices = await fetchUsdPrices("polygon", [TEL.toLowerCase(), NATIVE.toLowerCase()], fetchImpl as unknown as typeof fetch);
    expect(prices).toEqual({ [TEL.toLowerCase()]: 0.00215, [NATIVE.toLowerCase()]: 0.11 });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://coins.llama.fi/prices/current/polygon:${TEL.toLowerCase()},polygon:0x0000000000000000000000000000000000000000?searchWidth=12h`);
  });

  it("leaves out tokens it has no confident, positive price for", async () => {
    const fetchImpl = async () =>
      answer({
        coins: {
          [`polygon:${TEL.toLowerCase()}`]: { price: 0.002, confidence: 0.5 },
          [`polygon:${EMXN.toLowerCase()}`]: { price: 0, confidence: 0.99 },
        },
      });
    expect(await fetchUsdPrices("polygon", [TEL.toLowerCase(), EMXN.toLowerCase()], fetchImpl as unknown as typeof fetch)).toEqual({});
  });

  it("throws when DefiLlama answers with an error", async () => {
    await expect(fetchUsdPrices("polygon", [TEL.toLowerCase()], (async () => answer({}, 500)) as unknown as typeof fetch)).rejects.toThrow("DefiLlama answered 500");
  });
});
