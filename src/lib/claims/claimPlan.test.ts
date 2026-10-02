import { buildClaimPlan, claimAllLabel, claimRowInputs } from "./claimPlan";

describe("claimRowInputs", () => {
  it("makes a row for each chain and source with something claimable, and none for zero or unread amounts", () => {
    const inputs = claimRowInputs({ ethereum: 0, base: 120, polygon: null }, { base: undefined, polygon: 45 });
    expect(inputs).toEqual([
      { kind: "merkl", chain: "base", amountTel: 120 },
      { kind: "oldPools", chain: "polygon", amountTel: 45 },
    ]);
  });
});

describe("buildClaimPlan", () => {
  const inputs = claimRowInputs({ ethereum: 1_000, base: 50_000, polygon: 200_000 }, { polygon: 300 });

  it("puts the wallet's current chain first, then the rest by USD value, with unpriced legacy rows last", () => {
    const plan = buildClaimPlan(inputs, { currentChainId: 8453, telUsd: 0.002 });
    expect(plan.map((row) => row.id)).toEqual(["merkl:base", "merkl:polygon", "merkl:ethereum", "oldPools:polygon"]);
  });

  it("keeps every row on the current chain ahead of the others", () => {
    const plan = buildClaimPlan(inputs, { currentChainId: 137, telUsd: 0.002 });
    expect(plan.map((row) => row.id)).toEqual(["merkl:polygon", "oldPools:polygon", "merkl:base", "merkl:ethereum"]);
  });

  it("prices Merkl TEL but not legacy TEL, and gives each row its chain id", () => {
    const plan = buildClaimPlan(inputs, { telUsd: 0.002 });
    const polygon = plan.find((row) => row.id === "merkl:polygon");
    expect(polygon).toMatchObject({ chainId: 137, valueUsd: 400 });
    expect(plan.find((row) => row.id === "oldPools:polygon")).toMatchObject({ chainId: 137, valueUsd: null });
  });

  it("unchecks a row whose estimated fee is more than it's worth, and checks the rest", () => {
    const plan = buildClaimPlan(inputs, { telUsd: 0.002, feesUsd: { "merkl:ethereum": 3.5, "merkl:base": 0.01, "oldPools:polygon": 0.02 } });
    expect(plan.find((row) => row.id === "merkl:ethereum")).toMatchObject({ valueUsd: 2, feeUsd: 3.5, uneconomic: true, checked: false });
    expect(plan.find((row) => row.id === "merkl:base")).toMatchObject({ uneconomic: false, checked: true });
    // Legacy TEL has no price, so its fee can't make it uneconomic.
    expect(plan.find((row) => row.id === "oldPools:polygon")).toMatchObject({ uneconomic: false, checked: true });
    expect(plan.find((row) => row.id === "merkl:polygon")).toMatchObject({ feeUsd: null, checked: true });
  });

  it("orders by amount when there is no TEL price", () => {
    const plan = buildClaimPlan(inputs, { telUsd: null });
    expect(plan.map((row) => row.id)).toEqual(["merkl:polygon", "merkl:base", "merkl:ethereum", "oldPools:polygon"]);
  });
});

describe("claimAllLabel", () => {
  it("says Claim TEL for one chain, even with two sources on it", () => {
    expect(claimAllLabel(claimRowInputs({ polygon: 5 }, { polygon: 2 }))).toBe("Claim TEL");
  });

  it("counts the chains when there are several", () => {
    expect(claimAllLabel(claimRowInputs({ polygon: 5, base: 1 }, { base: 2 }))).toBe("Claim all (2 chains)");
  });
});
