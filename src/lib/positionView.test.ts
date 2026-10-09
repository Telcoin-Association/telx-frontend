import type { Position } from "./positions";
import {
  countPositions,
  filterPositions,
  formatTokenAmount,
  formatUsd,
  isClosedButSubscribed,
  isPositionInRange,
  orderPoolAssets,
  positionStatus,
  positionUsdValue,
  sortPositions,
  usdRate,
  withConfirmedSubscriptions,
} from "./positionView";

const Q96 = 2n ** 96n;

const position = (fields: Partial<Position> & { tokenId: string }): Position => ({
  isSubscribed: false,
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amounts: { amount0: "1", amount1: "2", sqrtPriceX96: Q96.toString() },
  price: { price1Per0: 2, price0Per1: 0.5 },
  ...fields,
});

const subscribed = position({ tokenId: "1", isSubscribed: true });
const notSubscribed = position({ tokenId: "2" });
const closed = position({ tokenId: "3", liquidity: "0" });
const closedSubscribed = position({ tokenId: "4", liquidity: "0", isSubscribed: true });
const all = [subscribed, notSubscribed, closed];

describe("positionStatus", () => {
  it("treats a position without liquidity as closed even when subscribed", () => {
    expect(positionStatus(subscribed)).toBe("subscribed");
    expect(positionStatus(notSubscribed)).toBe("notSubscribed");
    expect(positionStatus(closed)).toBe("closed");
    expect(positionStatus(closedSubscribed)).toBe("closed");
  });

  it("marks a closed position the registry still reports as subscribed", () => {
    expect(isClosedButSubscribed(closedSubscribed)).toBe(true);
    expect(isClosedButSubscribed(closed)).toBe(false);
    expect(isClosedButSubscribed(subscribed)).toBe(false);
  });
});

describe("filterPositions and countPositions", () => {
  it("leaves closed positions out of All", () => {
    expect(filterPositions(all, "all").map(p => p.tokenId)).toEqual(["1", "2"]);
    expect(filterPositions(all, "closed").map(p => p.tokenId)).toEqual(["3"]);
    expect(filterPositions(all, "subscribed").map(p => p.tokenId)).toEqual(["1"]);
    expect(filterPositions(all, "notSubscribed").map(p => p.tokenId)).toEqual(["2"]);
  });

  it("keeps every closed position under Closed, still subscribed or not, and counts the subscribed ones", () => {
    const withStillSubscribed = [...all, closedSubscribed];
    expect(filterPositions(withStillSubscribed, "all").map(p => p.tokenId)).toEqual(["1", "2"]);
    expect(filterPositions(withStillSubscribed, "closed").map(p => p.tokenId)).toEqual(["3", "4"]);
    expect(countPositions(withStillSubscribed)).toEqual({ all: 2, subscribed: 1, notSubscribed: 1, closed: 2, closedSubscribed: 1 });
  });

  it("counts what each filter shows", () => {
    expect(countPositions(all)).toEqual({ all: 2, subscribed: 1, notSubscribed: 1, closed: 1, closedSubscribed: 0 });
    expect(countPositions([])).toEqual({ all: 0, subscribed: 0, notSubscribed: 0, closed: 0, closedSubscribed: 0 });
  });
});

describe("formatTokenAmount", () => {
  it.each([
    ["0.000165854280435722", "0.0001659"],
    ["12.3456", "12.35"],
    ["1234567.891", "1,234,568"],
    ["1.5", "1.5"],
    ["0", "0"],
    ["0.0000000001", "<0.000001"],
    [0.5, "0.5"],
    ["not a number", "not a number"],
  ])("formats %p as %p", (input, expected) => {
    expect(formatTokenAmount(input)).toBe(expected);
  });

  it("honours a different number of significant digits", () => {
    expect(formatTokenAmount("0.123456", 2)).toBe("0.12");
  });
});

describe("formatUsd", () => {
  it("formats cents and marks values below a cent", () => {
    expect(formatUsd(1234.567)).toBe("$1,234.57");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("orderPoolAssets", () => {
  it("puts native ETH first and sorts the rest by address", () => {
    const tel = { ticker: "TEL", address: "0x09bE1692ca16e06f536F0038fF11D1dA8524aDB1" };
    const eth = { ticker: "ETH", address: null };
    expect(orderPoolAssets([tel, eth])).toEqual([eth, tel]);
    const weth = { ticker: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" };
    const legacyTel = { ticker: "TEL", address: "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32" };
    expect(orderPoolAssets([legacyTel, weth])).toEqual([weth, legacyTel]);
    expect(orderPoolAssets(undefined)).toEqual([]);
  });
});

describe("positionUsdValue", () => {
  const weth = { ticker: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" };
  const tel = { ticker: "TEL", address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731" };
  const legacyTel = { ticker: "TEL", address: "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32" };
  const eusd = { ticker: "eUSD", address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949" };
  const emxn = { ticker: "eMXN", address: "0x68727e573D21a49c767c3c86A92D9F24bd933c99" };
  const rates = { WETH: { USD: 3000 }, TEL: { USD: 0.005 } };
  const pos = position({
    tokenId: "1",
    amounts: { amount0: "0.5", amount1: "1000", sqrtPriceX96: "1" },
    price: { price1Per0: 600000, price0Per1: 0 },
  });

  it("prices both currencies from the market rates", () => {
    expect(positionUsdValue(pos, weth, tel, rates)).toBeCloseTo(0.5 * 3000 + 1000 * 0.005);
  });

  it("reads rates sent as numeric strings, as GET /api/market-rate sends them", () => {
    const stringRates = { WETH: { USD: "3000.000000" }, TEL: { USD: "0.005000" } };
    expect(positionUsdValue(pos, weth, tel, stringRates)).toBeCloseTo(0.5 * 3000 + 1000 * 0.005);
  });

  it("prices native ETH as WETH", () => {
    expect(positionUsdValue(pos, { ticker: "ETH", address: null }, tel, rates)).toBeCloseTo(1505);
  });

  it("prices legacy TEL from its partner through the pool price", () => {
    expect(positionUsdValue(pos, weth, legacyTel, rates)).toBeCloseTo(0.5 * 3000 + 1000 * (3000 / 600000));
  });

  it("prices currency0 from currency1 when only currency1 has a rate", () => {
    const eusdTel = position({
      tokenId: "1",
      amounts: { amount0: "10", amount1: "100", sqrtPriceX96: "1" },
      price: { price1Per0: 200, price0Per1: 0 },
    });
    expect(positionUsdValue(eusdTel, eusd, tel, rates)).toBeCloseTo(10 * 200 * 0.005 + 100 * 0.005);
  });

  it("returns null when neither currency has a rate or rates are missing", () => {
    expect(positionUsdValue(pos, eusd, emxn, rates)).toBeNull();
    expect(positionUsdValue(pos, weth, tel, undefined)).toBeNull();
  });
});

describe("isPositionInRange", () => {
  const at = (tick: number) => BigInt(Math.round(Math.sqrt(1.0001 ** tick) * 2 ** 48)) * 2n ** 48n;

  it("is in range when tickLower <= tick < tickUpper", () => {
    expect(isPositionInRange(position({ tokenId: "1" }))).toBe(true);
    expect(isPositionInRange(position({ tokenId: "1", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: at(-30.5).toString() } }))).toBe(true);
  });

  it("is out of range below and above", () => {
    expect(isPositionInRange(position({ tokenId: "1", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: at(-61).toString() } }))).toBe(false);
    expect(isPositionInRange(position({ tokenId: "1", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: at(60.5).toString() } }))).toBe(false);
  });

  it("returns null without a price", () => {
    expect(isPositionInRange(position({ tokenId: "1", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: "" } }))).toBeNull();
    expect(isPositionInRange(position({ tokenId: "1", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: "0" } }))).toBeNull();
  });
});

describe("usdRate", () => {
  it("reads numbers and numeric strings, case-insensitively", () => {
    expect(usdRate({ TEL: { USD: "0.002322" } }, "tel")).toBe(0.002322);
    expect(usdRate({ weth: { USD: 2680.85 } }, "WETH")).toBe(2680.85);
  });

  it("prices native ETH at the WETH rate", () => {
    expect(usdRate({ WETH: { USD: "2680.85" } }, "ETH")).toBe(2680.85);
    expect(usdRate({ WETH: { USD: "2680.85" } }, "eth")).toBe(2680.85);
    expect(usdRate({ TEL: { USD: "0.002" } }, "ETH")).toBeUndefined();
  });

  it("is undefined for a missing, zero, negative or unreadable rate", () => {
    expect(usdRate(undefined, "TEL")).toBeUndefined();
    expect(usdRate({}, "TEL")).toBeUndefined();
    expect(usdRate({ TEL: { USD: "0" } }, "TEL")).toBeUndefined();
    expect(usdRate({ TEL: { USD: "-1" } }, "TEL")).toBeUndefined();
    expect(usdRate({ TEL: { USD: "n/a" } }, "TEL")).toBeUndefined();
  });
});

describe("withConfirmedSubscriptions", () => {
  it("applies a confirmed subscription state over the one read, and leaves other rows alone", () => {
    const result = withConfirmedSubscriptions(all, { "2": true, "1": undefined });
    expect(result.map(p => p.isSubscribed)).toEqual([true, true, false]);
    expect(result[0]).toBe(subscribed);
    expect(result[2]).toBe(closed);
  });

  it("returns the same object when the read already agrees", () => {
    expect(withConfirmedSubscriptions([subscribed], { "1": true })[0]).toBe(subscribed);
  });
});

describe("sortPositions", () => {
  const weth = { ticker: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" };
  const tel = { ticker: "TEL", address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731" };
  const rates = { WETH: { USD: "3000" }, TEL: { USD: "0.005" } };
  const worth = (tokenId: string, amount0: string, fields: Partial<Position> = {}) =>
    position({ tokenId, amounts: { amount0, amount1: "0", sqrtPriceX96: Q96.toString() }, ...fields });

  it("puts open positions first by USD value, then closed ones, each tie newest first", () => {
    const sorted = sortPositions(
      [
        worth("5", "0", { liquidity: "0" }),
        worth("9", "0", { liquidity: "0", isSubscribed: true }),
        worth("10", "0.1"),
        worth("11", "2"),
        worth("12", "0.1"),
        worth("100", "1"),
      ],
      [weth, tel],
      rates,
    );
    expect(sorted.map(p => p.tokenId)).toEqual(["11", "100", "12", "10", "9", "5"]);
  });

  it("puts unpriced open positions after priced ones, newest first", () => {
    const sorted = sortPositions([worth("1", "1"), worth("2", "1"), worth("3", "0.5")], [weth, tel], undefined);
    expect(sorted.map(p => p.tokenId)).toEqual(["3", "2", "1"]);
    const mixed = sortPositions([worth("7", "1"), worth("8", "1")], [{ ticker: "XYZ", address: "0x1" }, { ticker: "ABC", address: "0x2" }], rates);
    expect(mixed.map(p => p.tokenId)).toEqual(["8", "7"]);
  });

  it("compares token ids as integers", () => {
    expect(sortPositions([worth("99", "1"), worth("100", "1")], [weth, tel], undefined).map(p => p.tokenId)).toEqual(["100", "99"]);
  });
});
