import { amountOrNull, formatTel, sumKnown, summarizePositions } from "./portfolioSummary";

const position = (overrides: Record<string, unknown> = {}): any => ({
  tokenId: "1",
  isSubscribed: true,
  tickLower: -100,
  tickUpper: 100,
  liquidity: "1000",
  amounts: { amount0: "1", amount1: "2000", sqrtPriceX96: "0" },
  price: { price1Per0: 2000 },
  ...overrides,
});

// WETH sorts before TEL by address, so WETH is currency0 whatever the registry order.
const WETH = { ticker: "WETH", address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619" };
const TEL = { ticker: "TEL", address: "0xe0000000000000000000000000000000000000e1" };
const rates = { WETH: { USD: 3000 }, TEL: { USD: 0.005 } };

describe("summarizePositions", () => {
  it("sums the value of open positions across pools and counts the subscribed ones", () => {
    const summary = summarizePositions(
      [
        { assets: [TEL, WETH], positions: [position(), position({ tokenId: "2", isSubscribed: false })] },
        { assets: [WETH, TEL], positions: [position({ tokenId: "3", liquidity: "0" })] },
      ],
      rates
    );
    // 1 WETH at $3000 plus 2000 TEL at $0.005, twice; the closed position counts nowhere.
    expect(summary).toEqual({ valueUsd: 6020, unpriced: 0, open: 2, subscribed: 1 });
  });

  it("leaves out positions that cannot be priced and says how many", () => {
    const eusd = { ticker: "eUSD", address: "0x1" };
    const emxn = { ticker: "eMXN", address: "0x2" };
    const summary = summarizePositions([{ assets: [eusd, emxn], positions: [position()] }], rates);
    expect(summary).toEqual({ valueUsd: null, unpriced: 1, open: 1, subscribed: 1 });
  });

  it("is empty for no positions", () => {
    expect(summarizePositions([], rates)).toEqual({ valueUsd: null, unpriced: 0, open: 0, subscribed: 0 });
  });
});

describe("sumKnown", () => {
  it("sums known values and marks the sum partial when any is unknown", () => {
    expect(sumKnown([1, 2, 3])).toEqual({ total: 6, partial: false });
    expect(sumKnown([1, null, 3])).toEqual({ total: 4, partial: true });
    expect(sumKnown([null, undefined])).toEqual({ total: null, partial: true });
    expect(sumKnown([0, 0])).toEqual({ total: 0, partial: false });
  });
});

describe("amountOrNull and formatTel", () => {
  it("reads amounts from strings and numbers", () => {
    expect(amountOrNull("12.5")).toBe(12.5);
    expect(amountOrNull(0)).toBe(0);
    expect(amountOrNull(null)).toBeNull();
    expect(amountOrNull("")).toBeNull();
    expect(amountOrNull("abc")).toBeNull();
  });

  it("formats TEL to two decimals", () => {
    expect(formatTel(1234.567)).toBe("1,234.57 TEL");
    expect(formatTel(0)).toBe("0 TEL");
  });
});
