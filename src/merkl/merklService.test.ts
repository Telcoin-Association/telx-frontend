/**
 * @jest-environment node
 */
import { TEL_TOKEN_ADDRESSES } from "./merklConstants";
import {
  fetchMerklRewards,
  summarizeMerklRewards,
  withRewardsClaimed,
} from "./merklService";
import type {
  MerklChainRewardsResponse,
  MerklRewardEntry,
  MerklToken,
} from "./merklTypes";

const USER = "0x00000000000000000000000000000000000000Aa";
const CHAIN_ID = 137;
const E18 = 10n ** 18n;

const tel: MerklToken = {
  chainId: CHAIN_ID,
  address: TEL_TOKEN_ADDRESSES[CHAIN_ID],
  decimals: 18,
  symbol: "TEL",
  price: 0.05,
};
// The older TEL on Polygon. Its symbol is TEL too, so its rewards count as TEL.
const legacyTel: MerklToken = {
  chainId: CHAIN_ID,
  address: "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32",
  decimals: 2,
  symbol: "TEL",
  price: 0.05,
};
const other: MerklToken = {
  chainId: CHAIN_ID,
  address: "0x00000000000000000000000000000000000000bb",
  decimals: 18,
  symbol: "OTHER",
  price: 1,
};

/** A reward of `amount` wei, none of it claimed yet, with `pending` wei not yet in a root. */
function reward(token: MerklToken, amount: bigint, pending = 0n): MerklRewardEntry {
  return {
    amount: amount.toString(),
    claimed: "0",
    pending: pending.toString(),
    proofs: ["0xproof"],
    token,
  };
}

function polygonEntry(
  rewards: MerklRewardEntry[],
  usd: Pick<MerklChainRewardsResponse, "amountUSD" | "claimedUSD" | "pendingUSD">
): MerklChainRewardsResponse {
  return { chain: { id: CHAIN_ID, name: "Polygon" }, rewards, ...usd };
}

/** One claimable reward of 1,000 TEL ($50) with 200 TEL ($10) pending. */
function oneTelReward() {
  return summarizeMerklRewards(
    [
      polygonEntry([reward(tel, 1_000n * E18, 200n * E18)], {
        amountUSD: "50",
        claimedUSD: "0",
        pendingUSD: "10",
      }),
    ],
    CHAIN_ID
  );
}

describe("fetchMerklRewards", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("summarizes the body the way summarizeMerklRewards does", async () => {
    const body = [
      polygonEntry([reward(tel, 1_000n * E18, 200n * E18), reward(other, 5n * E18)], {
        amountUSD: "55",
        claimedUSD: "0",
        pendingUSD: "10",
      }),
      { chain: { id: 8453, name: "Base" }, rewards: [reward({ ...tel, chainId: 8453 }, 7n * E18)] },
    ];
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await fetchMerklRewards(USER, CHAIN_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(summarizeMerklRewards(body, CHAIN_ID));
    expect(result.summary.totalAmount).toBe((1_000n * E18).toString());
  });
});

describe("withRewardsClaimed", () => {
  it("shows a claimed reward as claimed in full, in the summary and in raw", () => {
    const input = oneTelReward();
    expect(input.summary.totalClaimableUSD).toBe(50);

    const result = withRewardsClaimed(input, CHAIN_ID, input.summary.claimableRewards);

    expect(result.summary.totalClaimable).toBe("0");
    expect(result.summary.totalClaimed).toBe(result.summary.totalAmount);
    expect(result.summary.claimableRewards).toEqual([]);
    expect(result.summary.totalClaimableUSD).toBe(0);
    expect(result.raw[0].rewards[0].claimed).toBe((1_000n * E18).toString());
    // Pending is not part of the claim.
    expect(result.summary.totalPending).toBe((200n * E18).toString());
    expect(result.summary.totalPendingUSD).toBe(10);
    // The input is left as it was.
    expect(input).toEqual(oneTelReward());
  });

  it("leaves a reward that was not claimed claimable", () => {
    const input = summarizeMerklRewards(
      [
        polygonEntry([reward(tel, 1_000n * E18), reward(legacyTel, 50_000n)], {
          amountUSD: "75",
          claimedUSD: "0",
        }),
      ],
      CHAIN_ID
    );
    const [claimed, unclaimed] = input.summary.rewards;

    const result = withRewardsClaimed(input, CHAIN_ID, [claimed]);

    expect(result.summary.rewards[0].claimable).toBe("0");
    expect(result.summary.rewards[1].claimable).toBe(unclaimed.claimable);
    expect(result.summary.claimableRewards.map((r) => r.tokenAddress)).toEqual([
      legacyTel.address,
    ]);
    expect(result.summary.totalClaimableUSD).toBeCloseTo(25);
  });
});
