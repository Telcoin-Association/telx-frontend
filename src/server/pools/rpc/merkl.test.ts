/**
 * @jest-environment node
 */
import { fetchMerklTelPrice } from "./merkl";

const rows = [
  { address: "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32", symbol: "TEL", price: 0.0023 },
  { address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731", symbol: "TEL", price: 0.0023047589708217603 },
];
const answer = (status: number, body: unknown) => jest.fn(async () => new Response(JSON.stringify(body), { status }));

describe("fetchMerklTelPrice", () => {
  it("reads the TEL3 row for the chain", async () => {
    const fetcher = answer(200, rows);
    await expect(fetchMerklTelPrice(137, fetcher as unknown as typeof fetch)).resolves.toEqual({ usd: 0.0023047589708217603 });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("https://api.merkl.xyz/v4/tokens/?chainId=137&symbol=TEL");
  });

  it.each([
    ["an HTTP error", answer(500, {}), "HTTP 500"],
    ["no TEL3 row", answer(200, [rows[0]]), "no TEL3 row"],
    ["a row without a price", answer(200, [{ ...rows[1], price: null }]), "no TEL3 row"],
    ["a network failure", jest.fn(async () => Promise.reject(new TypeError("fetch failed"))), "fetch failed"],
  ])("answers null with a warning on %s, never throwing", async (_name, fetcher, warning) => {
    const result = await fetchMerklTelPrice(8453, fetcher as unknown as typeof fetch);
    expect(result.usd).toBeNull();
    expect(result.warning).toContain(warning);
  });
});
