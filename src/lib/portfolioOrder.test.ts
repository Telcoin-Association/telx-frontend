import { hasActivePositions, orderPortfolioGroups } from "./portfolioOrder";

const open = { liquidity: "100", isSubscribed: true };
const unsubscribed = { liquidity: "100", isSubscribed: false };
const closed = { liquidity: "0", isSubscribed: false };
const closedStillSubscribed = { liquidity: "0", isSubscribed: true };

const group = (name: string, blockchain: string, positions: (typeof open)[], value: number | null = null) => ({
  pool: { name, blockchain },
  positions,
  value,
});

describe("hasActivePositions", () => {
  it("counts liquidity, subscribed or not, and a closed position still subscribed", () => {
    expect(hasActivePositions([open])).toBe(true);
    expect(hasActivePositions([unsubscribed])).toBe(true);
    expect(hasActivePositions([closed, closedStillSubscribed])).toBe(true);
  });

  it("treats a pool of closed, unsubscribed positions as inactive", () => {
    expect(hasActivePositions([closed, closed])).toBe(false);
  });
});

describe("orderPortfolioGroups", () => {
  it("puts live pools first by network, then by value, and sets closed-only pools apart", () => {
    const groups = [
      group("eth closed", "ethereum", [closed]),
      group("base closed", "base", [closed, closed]),
      group("eth live", "ethereum", [open], 50),
      group("polygon small", "polygon", [open], 10),
      group("polygon closed", "polygon", [closed]),
      group("base live", "base", [unsubscribed], 5),
      group("polygon big", "polygon", [open, closed], 900),
      group("polygon unpriced", "polygon", [open], null),
    ];

    const { active, closed: closedOnly } = orderPortfolioGroups(groups, g => g.value);

    expect(active.map(g => g.pool.name)).toEqual(["polygon big", "polygon small", "polygon unpriced", "base live", "eth live"]);
    expect(closedOnly.map(g => g.pool.name)).toEqual(["polygon closed", "base closed", "eth closed"]);
  });

  it("returns empty lists for a wallet without positions", () => {
    expect(orderPortfolioGroups([], () => null)).toEqual({ active: [], closed: [] });
  });
});
