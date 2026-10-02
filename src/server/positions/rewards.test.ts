/**
 * @jest-environment node
 */
import { fetchPositionRewards, fetchWalletPositionRewards, reasonNamesToken, reasonTokenId, sumPositionRewards, walletPositionRewards } from "./rewards";

const TEL = { chainId: 137, address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731", decimals: 18, symbol: "TEL", price: 0.002 };
const OTHER = { chainId: 137, address: "0x0000000000000000000000000000000000000bbb", decimals: 6, symbol: "USDC", price: 1 };
const units = (whole: number) => (BigInt(whole) * 10n ** 18n).toString();

const breakdown = (tokenId: string, amount: string, pending = "0", campaignId = "0xc1") => ({
  root: "0x00",
  distributionChainId: 137,
  reason: `MultiLogPerAdditionalParam_tokenId_${tokenId}_2641197180095125678`,
  amount,
  claimed: "0",
  pending,
  campaignId,
  opportunityId: "1",
});

const body = (rewards: unknown[], chainId = 137) => [{ chain: { id: chainId, name: "Polygon" }, rewards }];

describe("reasonNamesToken", () => {
  it("matches the whole token id, not a prefix of a longer one", () => {
    expect(reasonNamesToken("MultiLogPerAdditionalParam_tokenId_143904_714", "143904")).toBe(true);
    expect(reasonNamesToken("MultiLogPerAdditionalParam_tokenId_1439041_714", "143904")).toBe(false);
    expect(reasonNamesToken("MultiLogPerAdditionalParam_tokenId_43904_714", "3904")).toBe(false);
    expect(reasonNamesToken("UniswapV4_tokenId_77", "77")).toBe(true);
  });
});

describe("sumPositionRewards", () => {
  it("sums credited and pending TEL across the position's campaigns, and nothing else", () => {
    const response = body([
      {
        token: TEL,
        amount: "0",
        claimed: "0",
        pending: "0",
        breakdowns: [
          breakdown("144100", units(75), units(1), "0xc1"),
          breakdown("144100", units(10), "0", "0xc2"),
          breakdown("145608", units(40), "0", "0xc1"),
        ],
      },
      { token: OTHER, amount: "0", claimed: "0", pending: "0", breakdowns: [breakdown("144100", "5000000")] },
    ]);

    expect(sumPositionRewards(response, 137, "144100")).toEqual({ symbol: "TEL", token: TEL.address.toLowerCase(), amount: 86, priceUSD: 0.002 });
  });

  it("counts a breakdown that Merkl lists twice only once", () => {
    const response = body([{ token: TEL, breakdowns: [breakdown("7", units(3)), breakdown("7", units(3))] }]);
    expect(sumPositionRewards(response, 137, "7")!.amount).toBe(3);
  });

  it("ignores another chain's rewards and is null when no breakdown names the position", () => {
    expect(sumPositionRewards(body([{ token: TEL, breakdowns: [breakdown("7", units(3))] }], 8453), 137, "7")).toBeNull();
    expect(sumPositionRewards(body([{ token: TEL, breakdowns: [breakdown("8", units(3))] }]), 137, "7")).toBeNull();
    expect(sumPositionRewards({ unexpected: true }, 137, "7")).toBeNull();
  });
});

describe("fetchPositionRewards", () => {
  const respond = (status: number, json: unknown) => jest.fn(async () => ({ ok: status === 200, status, json: async () => json }) as unknown as Response);

  it("reads the owner's rewards on the position's chain", async () => {
    const fetchImpl = respond(200, body([{ token: TEL, breakdowns: [breakdown("9", units(2))] }]));
    await expect(fetchPositionRewards("polygon", "0xabc", "9", fetchImpl)).resolves.toMatchObject({ amount: 2, symbol: "TEL" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.merkl.xyz/v4/users/0xabc/rewards?chainId=137", expect.anything());
  });

  it("is zero when the owner has nothing for this position, and null when Merkl fails or answers oddly", async () => {
    await expect(fetchPositionRewards("base", "0xabc", "9", respond(200, []))).resolves.toEqual({ symbol: "TEL", token: "", amount: 0, priceUSD: null });
    await expect(fetchPositionRewards("base", "0xabc", "9", respond(500, {}))).resolves.toBeNull();
    await expect(fetchPositionRewards("base", "0xabc", "9", respond(200, { error: "x" }))).resolves.toBeNull();
  });
});

describe("reasonTokenId", () => {
  it("reads the whole token id a reason names", () => {
    expect(reasonTokenId("MultiLogPerAdditionalParam_tokenId_144097_7140342370385179795")).toBe("144097");
    expect(reasonTokenId("UniswapV4_tokenId_77")).toBe("77");
    expect(reasonTokenId("Erc20Holder_0xabc")).toBeNull();
  });
});

describe("walletPositionRewards", () => {
  const claimedBreakdown = (tokenId: string, amount: string, claimed: string, pending: string, campaignId: string) => ({
    ...breakdown(tokenId, amount, pending, campaignId),
    claimed,
  });

  it("splits a wallet's TEL by position: earned, claimed, pending and unclaimed", () => {
    const response = body([
      {
        token: TEL,
        amount: "0",
        claimed: "0",
        pending: "0",
        breakdowns: [
          claimedBreakdown("144097", units(120_000), units(93_000), units(4_000), "0xc1"),
          claimedBreakdown("144097", units(5_000), "0", units(500), "0xc2"),
          claimedBreakdown("143904", units(116_000), "0", "0", "0xc1"),
          // Listed twice by Merkl: counted once.
          claimedBreakdown("143904", units(116_000), "0", "0", "0xc1"),
        ],
      },
      { token: OTHER, amount: "0", claimed: "0", pending: "0", breakdowns: [breakdown("143904", "5000000")] },
    ]);

    expect(walletPositionRewards(response, 137)).toEqual({
      priceUSD: 0.002,
      positions: {
        "144097": { earned: 129_500, claimed: 93_000, pending: 4_500, unclaimed: 36_500 },
        "143904": { earned: 116_000, claimed: 0, pending: 0, unclaimed: 116_000 },
      },
    });
  });

  it("is empty for a wallet with no position rewards on the chain, and null for an unreadable body", () => {
    expect(walletPositionRewards(body([], 8453), 137)).toEqual({ priceUSD: null, positions: {} });
    expect(walletPositionRewards({ unexpected: true }, 137)).toBeNull();
  });
});

describe("fetchWalletPositionRewards", () => {
  it("reads the owner's rewards on the chain once, with the owner lowercased in the result", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => body([{ token: TEL, amount: "0", claimed: "0", pending: "0", breakdowns: [breakdown("7", units(10))] }]) });
    const result = await fetchWalletPositionRewards("polygon", "0xAbC0000000000000000000000000000000000001", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.merkl.xyz/v4/users/0xAbC0000000000000000000000000000000000001/rewards?chainId=137");
    expect(result).toEqual({ chain: "polygon", owner: "0xabc0000000000000000000000000000000000001", priceUSD: 0.002, positions: { "7": { earned: 10, claimed: 0, pending: 0, unclaimed: 10 } } });
  });

  it("is null when Merkl fails", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchWalletPositionRewards("base", "0x0000000000000000000000000000000000000001", fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });
});
