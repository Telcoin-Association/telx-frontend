/**
 * @jest-environment node
 */
import { ALLOWANCE_HOLDER, getSwapQuote, NATIVE_TOKEN, quoteUrl, type QuoteRequest } from "./zeroEx";

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const TAKER = "0x00000000000000000000000000000000000000aa";
const SETTLER = "0x03f115b015B210F812829EA076A7643AC80c2C97";
const OLD_SETTLER = "0x5AAc9c02D107bFe45e878d01Bc8C7ccf6329F410";

const request = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  chain: "polygon",
  sellToken: USDC,
  buyToken: TEL,
  sellAmount: 1_000_000n,
  taker: TAKER,
  slippageBps: 50,
  ...overrides,
});

const quoteBody = (overrides: Record<string, unknown> = {}) => ({
  liquidityAvailable: true,
  sellAmount: "1000000",
  buyAmount: "430000000000000000000",
  minBuyAmount: "427850000000000000000",
  issues: { allowance: { actual: "0", spender: ALLOWANCE_HOLDER }, balance: null, simulationIncomplete: false },
  transaction: { to: ALLOWANCE_HOLDER, data: "0xabcd", gas: "210000", gasPrice: "30000000000", value: "0" },
  route: { fills: [{ source: "Uniswap_V4" }, { source: "Uniswap_V4" }, { source: "QuickSwap_V3" }] },
  ...overrides,
});

const respond = (status: number, body: unknown) => jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const deps = (fetchImpl: jest.Mock, settlers = jest.fn().mockResolvedValue([SETTLER, OLD_SETTLER])) => ({ apiKey: "key", fetch: fetchImpl as unknown as typeof fetch, settlers });

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe("quoteUrl", () => {
  it("asks for a firm quote with a taker and an indicative price without one, naming the chain by id", () => {
    expect(quoteUrl(request())).toBe(
      `https://api.0x.org/swap/allowance-holder/quote?chainId=137&sellToken=${USDC}&buyToken=${TEL}&sellAmount=1000000&slippageBps=50&taker=${TAKER}`,
    );
    expect(quoteUrl(request({ taker: null, chain: "base" }))).toMatch(/^https:\/\/api\.0x\.org\/swap\/allowance-holder\/price\?chainId=8453&/);
    expect(quoteUrl(request())).not.toMatch(/swapFee/);
  });
});

describe("getSwapQuote", () => {
  it("is not available without a key, and makes no request", async () => {
    const fetchImpl = jest.fn();
    await expect(getSwapQuote(request(), { ...deps(fetchImpl), apiKey: undefined })).resolves.toEqual({
      status: 503,
      body: { error: "Swaps aren't available yet." },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the key and API version, and returns the checked quote", async () => {
    const fetchImpl = respond(200, quoteBody());
    const result = await getSwapQuote(request(), deps(fetchImpl));
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "0x-api-key": "key", "0x-version": "v2" });
    expect(result).toEqual({
      status: 200,
      body: {
        liquidityAvailable: true,
        sellAmount: "1000000",
        buyAmount: "430000000000000000000",
        minBuyAmount: "427850000000000000000",
        allowance: { spender: ALLOWANCE_HOLDER, actual: "0" },
        balanceShort: false,
        gas: "210000",
        gasPrice: "30000000000",
        sources: ["Uniswap_V4", "QuickSwap_V3"],
        zeroExFee: null,
        transaction: { to: ALLOWANCE_HOLDER, data: "0xabcd", value: "0", gas: "210000" },
      },
    });
  });

  it("passes on 0x's own fee, and reads a fee block it can't parse as no fee", async () => {
    const charged = await getSwapQuote(request(), deps(respond(200, quoteBody({ fees: { zeroExFee: { amount: "1500", token: USDC.toLowerCase(), type: "volume" } } }))));
    expect(charged.status === 200 && "zeroExFee" in charged.body && charged.body.zeroExFee).toEqual({ amount: "1500", token: USDC });
    const odd = await getSwapQuote(request(), deps(respond(200, quoteBody({ fees: { zeroExFee: { amount: "lots" } } }))));
    expect(odd.status).toBe(200);
    expect("zeroExFee" in odd.body && odd.body.zeroExFee).toBeNull();
  });

  it("refuses a token sell whose transaction is not addressed to AllowanceHolder", async () => {
    const result = await getSwapQuote(request(), deps(respond(200, quoteBody({ transaction: { to: SETTLER, data: "0x", value: "0" } }))));
    expect(result).toEqual({ status: 502, body: { error: "The swap route could not be verified, so it was not offered." } });
  });

  it("refuses an approval target other than AllowanceHolder", async () => {
    const result = await getSwapQuote(request(), deps(respond(200, quoteBody({ issues: { allowance: { actual: "0", spender: SETTLER }, balance: null } }))));
    expect(result.status).toBe(502);
  });

  it("accepts a native sell addressed to AllowanceHolder, as 0x's AllowanceHolder flow sends it, without reading the registry", async () => {
    const settlers = jest.fn();
    const body = quoteBody({ issues: { allowance: null, balance: null }, transaction: { to: ALLOWANCE_HOLDER.toLowerCase(), data: "0x", value: "1000000" } });
    const result = await getSwapQuote(request({ sellToken: NATIVE_TOKEN }), deps(respond(200, body), settlers));
    expect(result).toMatchObject({ status: 200, body: { transaction: { to: ALLOWANCE_HOLDER, value: "1000000" } } });
    expect(settlers).not.toHaveBeenCalled();
  });

  it("accepts a native sell addressed to the current or previous registered Settler, and refuses any other", async () => {
    const native = request({ sellToken: NATIVE_TOKEN });
    const toSettler = (to: string) => quoteBody({ issues: { allowance: null, balance: null }, transaction: { to, data: "0x", value: "1000000" } });
    await expect(getSwapQuote(native, deps(respond(200, toSettler(SETTLER))))).resolves.toMatchObject({ status: 200 });
    await expect(getSwapQuote(native, deps(respond(200, toSettler(OLD_SETTLER.toLowerCase()))))).resolves.toMatchObject({ status: 200 });
    await expect(getSwapQuote(native, deps(respond(200, toSettler("0x00000000000000000000000000000000000000ee"))))).resolves.toMatchObject({ status: 502 });
    const failingRegistry = jest.fn().mockRejectedValue(new Error("rpc down"));
    await expect(getSwapQuote(native, deps(respond(200, toSettler(SETTLER)), failingRegistry))).resolves.toMatchObject({ status: 502 });
  });

  it("passes an indicative price through without a transaction, and flags a short balance", async () => {
    const price = quoteBody({ transaction: undefined, gas: "200000", gasPrice: "1", issues: { allowance: null, balance: { token: USDC, actual: "5", expected: "1000000" } } });
    const result = await getSwapQuote(request({ taker: null }), deps(respond(200, price)));
    expect(result).toMatchObject({ status: 200, body: { transaction: null, gas: "200000", balanceShort: true, allowance: null } });
  });

  it("answers no liquidity as a normal result", async () => {
    await expect(getSwapQuote(request(), deps(respond(200, { liquidityAvailable: false, zid: "x" })))).resolves.toEqual({
      status: 200,
      body: { liquidityAvailable: false },
    });
  });

  it("maps 0x's errors: input errors to 400 with 0x's message, rate limits to 429, a rejected key to 503, the rest to 502", async () => {
    await expect(getSwapQuote(request(), deps(respond(400, { name: "INPUT_INVALID", message: "Invalid sellAmount" })))).resolves.toEqual({
      status: 400,
      body: { error: "0x rejected the swap: Invalid sellAmount" },
    });
    await expect(getSwapQuote(request(), deps(respond(429, {})))).resolves.toMatchObject({ status: 429 });
    await expect(getSwapQuote(request(), deps(respond(401, { name: "UNAUTHORIZED" })))).resolves.toMatchObject({ status: 503 });
    await expect(getSwapQuote(request(), deps(respond(500, {})))).resolves.toMatchObject({ status: 502 });
    await expect(getSwapQuote(request(), deps(jest.fn().mockRejectedValue(new Error("network"))))).resolves.toMatchObject({ status: 502 });
    await expect(getSwapQuote(request(), deps(respond(200, { liquidityAvailable: true, buyAmount: "x" })))).resolves.toMatchObject({ status: 502 });
  });
});
