/**
 * @jest-environment node
 */
import { GET } from "./route";
import { parseQuoteQuery } from "../../../../server/swap/quoteQuery";
import { withEnv } from "../../../../server/pools/testing";

const mockReadContract = jest.fn();
jest.mock("../../backendHelpers/alchemy", () => ({
  publicClientEthereum: { readContract: (...args: unknown[]) => mockReadContract(...args) },
  publicClientPolygon: { readContract: (...args: unknown[]) => mockReadContract(...args) },
  publicClientBase: { readContract: (...args: unknown[]) => mockReadContract(...args) },
}));

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const TAKER = "0x00000000000000000000000000000000000000aa";
const SETTLER = "0x03f115b015B210F812829EA076A7643AC80c2C97";

const url = (params: Record<string, string>) => `https://telx.network/api/swap/quote?${new URLSearchParams(params)}`;
const valid = { chain: "polygon", sellToken: USDC, buyToken: TEL, sellAmount: "1000000", taker: TAKER };

let restore: () => void;
const realFetch = global.fetch;

beforeEach(() => {
  restore = withEnv({ ZEROX_API_KEY: "test-key", PREVIEW_BASIC_AUTH: undefined });
  mockReadContract.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  restore();
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe("parseQuoteQuery", () => {
  it.each([
    [{ ...valid, chain: "arbitrum" }, "Pick Ethereum, Polygon or Base."],
    [{ ...valid, sellToken: "TEL" }, "Pick an asset to sell and an asset to buy."],
    [{ ...valid, buyToken: USDC.toLowerCase() }, "The sell asset and buy asset must be different."],
    [{ ...valid, sellAmount: "0" }, "Enter an amount to sell."],
    [{ ...valid, sellAmount: "1.5" }, "Enter an amount to sell."],
    [{ ...valid, taker: "me" }, "The connected wallet address isn't valid. Reconnect the wallet and try again."],
    [{ ...valid, slippageBps: "0" }, "Slippage must be between 0.01% and 50%."],
    [{ ...valid, slippageBps: "5001" }, "Slippage must be between 0.01% and 50%."],
  ])("rejects %j", (params, error) => {
    expect(parseQuoteQuery(new URLSearchParams(params))).toEqual({ ok: false, error });
  });

  it("accepts a request without a taker or slippage", () => {
    const { taker: _taker, ...rest } = valid;
    expect(parseQuoteQuery(new URLSearchParams(rest))).toMatchObject({ ok: true, taker: null, slippageBps: null, sellAmount: 1_000_000n });
  });
});

describe("GET /api/swap/quote", () => {
  it("answers an invalid request with 400 and calls nothing", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const res = await GET(new Request(url({ ...valid, chain: "solana" })));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers 503 while ZEROX_API_KEY is not set", async () => {
    restore();
    restore = withEnv({ ZEROX_API_KEY: undefined, PREVIEW_BASIC_AUTH: undefined });
    const res = await GET(new Request(url(valid)));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Swaps aren't available yet." });
  });

  it("offers a native POL sell that 0x addresses to AllowanceHolder", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          liquidityAvailable: true,
          sellAmount: "1000000000000000000",
          buyAmount: "1",
          minBuyAmount: "1",
          issues: { allowance: null, balance: null },
          transaction: { to: "0x0000000000001ff3684f28c67538d4d072c22734", data: "0x", value: "1000000000000000000" },
        }),
      ),
    ) as unknown as typeof fetch;
    const res = await GET(new Request(url({ ...valid, chain: "polygon", sellToken: NATIVE, sellAmount: "1000000000000000000" })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ transaction: { to: "0x0000000000001fF3684f28c67538d4D072C22734", value: "1000000000000000000" } });
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it("checks a native sell's Settler against 0x's registry on the requested chain", async () => {
    mockReadContract.mockImplementation(async ({ functionName }: { functionName: string }) => (functionName === "ownerOf" ? SETTLER : "0x5AAc9c02D107bFe45e878d01Bc8C7ccf6329F410"));
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          liquidityAvailable: true,
          sellAmount: "1000000000000000000",
          buyAmount: "1",
          minBuyAmount: "1",
          issues: { allowance: null, balance: null },
          transaction: { to: SETTLER, data: "0x", value: "1000000000000000000" },
        }),
      ),
    ) as unknown as typeof fetch;
    const res = await GET(new Request(url({ ...valid, sellToken: NATIVE, sellAmount: "1000000000000000000" })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ liquidityAvailable: true, transaction: { to: SETTLER } });
    expect(mockReadContract).toHaveBeenCalledWith(expect.objectContaining({ address: "0x00000000000004533Fe15556B1E086BB1A72cEae", functionName: "ownerOf" }));
  });
});
