// Must stay the first import: see its jest.mock below.
import "jsdom-text-encoding";
import { act, renderHook } from "@testing-library/react";
import { polygon } from "viem/chains";
import { useWalletClient } from "wagmi";
import { publicClientPolygon } from "../lib/publicClients";
import { TEL_TOKEN_ADDRESSES } from "./merklConstants";
import { fetchMerklRewards } from "./merklService";
import {
  notifyMerklClaimError,
  notifyMerklClaimRejected,
  notifyMerklClaimSuccess,
} from "./merklToasts";
import type {
  FetchMerklRewardsResult,
  MerklRewardEntry,
  ParsedMerklReward,
} from "./merklTypes";
import { useMerklClaim } from "./useMerklClaim";

// viem creates a TextEncoder as it loads and jsdom has none. Imports run before
// any other statement, so Node's encoders are installed by this module, which
// is imported ahead of everything that loads viem.
jest.mock(
  "jsdom-text-encoding",
  () => {
    const { TextDecoder, TextEncoder } = jest.requireActual("util");
    Object.assign(globalThis, { TextDecoder, TextEncoder });
    return {};
  },
  { virtual: true }
);
jest.mock("wagmi", () => ({ useWalletClient: jest.fn() }));
jest.mock("../lib/publicClients", () => ({
  publicClientEthereum: { waitForTransactionReceipt: jest.fn() },
  publicClientBase: { waitForTransactionReceipt: jest.fn() },
  publicClientPolygon: { waitForTransactionReceipt: jest.fn() },
}));
// Only the network call is replaced, so the pure helpers in the service stay real.
jest.mock("./merklService", () => ({
  ...jest.requireActual("./merklService"),
  fetchMerklRewards: jest.fn(),
}));
jest.mock("./merklToasts", () => ({
  notifyMerklClaimError: jest.fn(),
  notifyMerklClaimRejected: jest.fn(),
  notifyMerklClaimSuccess: jest.fn(),
}));

const USER = "0x00000000000000000000000000000000000000Aa";
const CHAIN_ID = polygon.id;
const TEL = TEL_TOKEN_ADDRESSES[CHAIN_ID];
const HASH = `0x${"ab".repeat(32)}`;
const PROOF = `0x${"11".repeat(32)}`;
const EARNED = 1_000n * 10n ** 18n;
// Longer than the whole polling window after a claim.
const POLL_WINDOW_MS = 6 * 60_000;

/**
 * The rewards result for one TEL reward of EARNED on Polygon, `claimed` of it
 * already claimed, laid out the way fetchMerklRewards parses it. There is no
 * token price, so every USD value is 0.
 */
function rewardsResult(claimed = 0n): FetchMerklRewardsResult {
  const entry: MerklRewardEntry = {
    amount: EARNED.toString(),
    claimed: claimed.toString(),
    pending: "0",
    proofs: [PROOF],
    token: { chainId: CHAIN_ID, address: TEL, decimals: 18, symbol: "TEL", name: "Telcoin" },
  };
  const claimable = EARNED > claimed ? EARNED - claimed : 0n;
  const reward: ParsedMerklReward = {
    amount: entry.amount,
    claimed: entry.claimed,
    pending: "0",
    claimable: claimable.toString(),
    tokenAddress: TEL,
    tokenSymbol: "TEL",
    tokenName: "Telcoin",
    tokenDecimals: 18,
    amountUSD: 0,
    claimedUSD: 0,
    claimableUSD: 0,
    pendingUSD: 0,
    proofs: entry.proofs,
    isClaimable: claimable > 0n,
    raw: entry,
  };
  const claimableRewards = reward.isClaimable ? [reward] : [];

  return {
    raw: [{ chain: { id: CHAIN_ID, name: "Polygon" }, rewards: [entry] }],
    summary: {
      rewards: [reward],
      totalAmount: entry.amount,
      totalClaimed: entry.claimed,
      totalClaimable: reward.claimable,
      totalPending: "0",
      totalAmountUSD: 0,
      totalClaimedUSD: 0,
      totalClaimableUSD: 0,
      totalPendingUSD: 0,
      totalProofsCount: claimableRewards.length,
      claimableRewards,
    },
    isEmpty: false,
  };
}

const walletClient = { switchChain: jest.fn(), writeContract: jest.fn() };
const fetchRewards = jest.mocked(fetchMerklRewards);
const waitForReceipt =
  publicClientPolygon.waitForTransactionReceipt as unknown as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  jest.mocked(useWalletClient).mockReturnValue({
    data: walletClient,
  } as unknown as ReturnType<typeof useWalletClient>);
  walletClient.switchChain.mockResolvedValue(undefined);
  walletClient.writeContract.mockResolvedValue(HASH);
  // The first fetch is the card's load. Any later one comes after the claim
  // was mined, when the reward shows as claimed in full.
  fetchRewards.mockResolvedValue(rewardsResult(EARNED));
  fetchRewards.mockResolvedValueOnce(rewardsResult());
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Lets pending promises and their state updates run without moving the clock.
const flush = () => act(() => jest.advanceTimersByTimeAsync(0));

// Renders the hook for Polygon and waits for the first rewards load.
async function renderLoaded() {
  const view = renderHook(() => useMerklClaim(USER, CHAIN_ID, "polygon"));
  await flush();
  expect(view.result.current.claimableAmount).toBe("1000");

  // Runs a claim and lets any polling it starts run to its end.
  const claim = () =>
    act(async () => {
      const claiming = view.result.current.claimMerklRewards();
      await jest.advanceTimersByTimeAsync(POLL_WINDOW_MS);
      await claiming;
    });

  return { ...view, claim };
}

describe("useMerklClaim claim", () => {
  it("treats a reverted receipt as a failed claim", async () => {
    waitForReceipt.mockResolvedValue({ status: "reverted" });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { result, claim, unmount } = await renderLoaded();

    await claim();

    expect(waitForReceipt).toHaveBeenCalledWith({ hash: HASH });
    expect(notifyMerklClaimError).toHaveBeenCalledWith("Claim transaction reverted");
    expect(notifyMerklClaimSuccess).not.toHaveBeenCalled();
    expect(result.current.claimSuccess).toBe(false);
    expect(result.current.isClaiming).toBe(false);
    // Only the load fetched rewards; nothing polled after the receipt.
    expect(fetchRewards).toHaveBeenCalledTimes(1);
    expect(result.current.claimableAmount).toBe("1000");
    unmount();
  });

  it("reports a claim whose receipt succeeds as claimed", async () => {
    waitForReceipt.mockResolvedValue({ status: "success" });
    const { result, claim, unmount } = await renderLoaded();

    await claim();

    expect(walletClient.switchChain).toHaveBeenCalledWith({ id: CHAIN_ID });
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "claim",
        args: [[USER], [TEL], [EARNED], [[PROOF]]],
      })
    );
    expect(notifyMerklClaimSuccess).toHaveBeenCalledTimes(1);
    expect(notifyMerklClaimError).not.toHaveBeenCalled();
    expect(result.current.claimSuccess).toBe(true);
    expect(result.current.isClaiming).toBe(false);
    unmount();
  });

  it("reports a wallet rejection as cancelled, not as a failure", async () => {
    walletClient.writeContract.mockRejectedValue(
      Object.assign(new Error("User rejected the request."), { code: 4001 })
    );
    const { result, claim, unmount } = await renderLoaded();

    await claim();

    expect(notifyMerklClaimRejected).toHaveBeenCalledTimes(1);
    expect(notifyMerklClaimError).not.toHaveBeenCalled();
    expect(notifyMerklClaimSuccess).not.toHaveBeenCalled();
    expect(waitForReceipt).not.toHaveBeenCalled();
    expect(result.current.claimSuccess).toBe(false);
    expect(result.current.isClaiming).toBe(false);
    unmount();
  });
});
