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
import {
  CLAIM_CONFIRM_POLL_DELAYS_MS,
  CLAIM_CONFIRM_TIMEOUT_MS,
  useMerklClaim,
} from "./useMerklClaim";

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
const OTHER_USER = "0x00000000000000000000000000000000000000Bb";
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

/** A promise and its resolve function, so a test decides when a polled fetch returns. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
// Moves the clock by `ms` and lets what that releases run.
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

// Renders the hook for USER on Polygon and waits for the first rewards load.
// `rerender({ user })` switches the wallet.
async function renderLoaded() {
  const view = renderHook(
    ({ user }: { user: string }) => useMerklClaim(user, CHAIN_ID, "polygon"),
    { initialProps: { user: USER } }
  );
  await flush();
  expect(view.result.current.claimableAmount).toBe("1000");

  // Runs a claim and lets any polling it starts run to its end.
  const claim = () =>
    act(async () => {
      const claiming = view.result.current.claimMerklRewards();
      await jest.advanceTimersByTimeAsync(POLL_WINDOW_MS);
      await claiming;
    });

  // Starts a claim and runs it up to its first poll without moving the clock.
  // Nothing awaits the claim, so a poll that never returns cannot hold the test.
  const startClaim = () =>
    act(async () => {
      void view.result.current.claimMerklRewards();
      await jest.advanceTimersByTimeAsync(0);
    });

  return { ...view, claim, startClaim };
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

describe("useMerklClaim after a mined claim", () => {
  const [FIRST_DELAY_MS] = CLAIM_CONFIRM_POLL_DELAYS_MS;

  beforeEach(() => {
    waitForReceipt.mockResolvedValue({ status: "success" });
  });

  it("shows the rewards as claimed at the receipt, before any poll returns", async () => {
    fetchRewards.mockReturnValueOnce(new Promise<FetchMerklRewardsResult>(() => {}));
    const { result, startClaim, unmount } = await renderLoaded();

    await startClaim();

    expect(fetchRewards).toHaveBeenCalledTimes(2);
    expect(fetchRewards).toHaveBeenLastCalledWith(USER, CHAIN_ID, { reloadChainId: CHAIN_ID });
    expect(result.current.claimableAmount).toBe("0");
    expect(result.current.claimedAmount).toBe("1000");
    expect(result.current.isClaiming).toBe(false);
    expect(result.current.claimSuccess).toBe(true);
    expect(result.current.isReconcilingAfterClaim).toBe(true);
    expect(notifyMerklClaimSuccess).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("drops a stale poll and polls again after the first delay", async () => {
    const poll = deferred<FetchMerklRewardsResult>();
    fetchRewards.mockReturnValueOnce(poll.promise);
    const { result, startClaim, unmount } = await renderLoaded();
    await startClaim();
    const atReceipt = result.current.merklRewards;

    poll.resolve(rewardsResult());
    await flush();

    expect(result.current.claimableAmount).toBe("0");
    expect(result.current.merklRewards).toBe(atReceipt);
    expect(result.current.isReconcilingAfterClaim).toBe(true);
    await advance(FIRST_DELAY_MS - 1);
    expect(fetchRewards).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchRewards).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("applies a poll that shows the claim and stops polling", async () => {
    const confirmed = rewardsResult(EARNED);
    fetchRewards.mockResolvedValueOnce(confirmed);
    const { result, startClaim, unmount } = await renderLoaded();

    await startClaim();

    expect(result.current.merklRewards).toBe(confirmed);
    expect(result.current.isReconcilingAfterClaim).toBe(false);
    await advance(CLAIM_CONFIRM_TIMEOUT_MS);
    expect(fetchRewards).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("logs a failed poll and polls again without reporting the claim as failed", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchRewards.mockRejectedValueOnce(new Error("network down"));
    const { result, startClaim, unmount } = await renderLoaded();

    await startClaim();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(notifyMerklClaimError).not.toHaveBeenCalled();
    expect(result.current.claimSuccess).toBe(true);
    expect(result.current.isReconcilingAfterClaim).toBe(true);
    await advance(FIRST_DELAY_MS);
    expect(fetchRewards).toHaveBeenCalledTimes(3);
    // The next poll shows the claim, so polling ends there.
    expect(result.current.isReconcilingAfterClaim).toBe(false);
    expect(notifyMerklClaimError).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps the state from the receipt when no poll shows the claim in time", async () => {
    fetchRewards.mockResolvedValue(rewardsResult());
    const { result, startClaim, unmount } = await renderLoaded();
    await startClaim();
    const atReceipt = result.current.merklRewards;
    expect(result.current.claimableAmount).toBe("0");

    await advance(CLAIM_CONFIRM_TIMEOUT_MS);

    expect(result.current.isReconcilingAfterClaim).toBe(false);
    expect(result.current.merklRewards).toBe(atReceipt);
    expect(result.current.claimableAmount).toBe("0");
    const polls = fetchRewards.mock.calls.length;
    await advance(CLAIM_CONFIRM_TIMEOUT_MS);
    expect(fetchRewards).toHaveBeenCalledTimes(polls);
    unmount();
  });

  it("stops polling when it unmounts", async () => {
    fetchRewards.mockResolvedValue(rewardsResult());
    const { startClaim, unmount } = await renderLoaded();
    await startClaim();
    expect(fetchRewards).toHaveBeenCalledTimes(2);

    unmount();
    await advance(CLAIM_CONFIRM_TIMEOUT_MS);

    expect(fetchRewards).toHaveBeenCalledTimes(2);
  });
});

describe("useMerklClaim after a claim, when the wallet changes", () => {
  // The rewards the other wallet loads: 400 of EARNED claimed, 600 left.
  const otherWallet = rewardsResult(400n * 10n ** 18n);

  beforeEach(() => {
    waitForReceipt.mockResolvedValue({ status: "success" });
  });

  it("drops a confirming poll for the old wallet and keeps the new wallet's rewards", async () => {
    const poll = deferred<FetchMerklRewardsResult>();
    fetchRewards.mockReturnValueOnce(poll.promise).mockResolvedValueOnce(otherWallet);
    const { result, rerender, startClaim, unmount } = await renderLoaded();
    await startClaim();

    rerender({ user: OTHER_USER });
    await flush();
    expect(fetchRewards).toHaveBeenLastCalledWith(OTHER_USER, CHAIN_ID, undefined);
    expect(result.current.merklRewards).toBe(otherWallet);

    poll.resolve(rewardsResult(EARNED));
    await flush();

    expect(result.current.merklRewards).toBe(otherWallet);
    expect(result.current.claimableAmount).toBe("600");
    unmount();
  });

  it("does not hold up the new wallet's claim while the old wallet's poll runs", async () => {
    fetchRewards
      .mockReturnValueOnce(new Promise<FetchMerklRewardsResult>(() => {}))
      .mockResolvedValueOnce(otherWallet);
    const { result, rerender, startClaim, unmount } = await renderLoaded();
    await startClaim();
    expect(result.current.isReconcilingAfterClaim).toBe(true);

    rerender({ user: OTHER_USER });
    await flush();

    expect(result.current.isReconcilingAfterClaim).toBe(false);
    expect(result.current.claimableAmount).toBe("600");
    unmount();
  });

  it("sends no further poll for the old wallet", async () => {
    fetchRewards.mockResolvedValue(rewardsResult());
    const { rerender, startClaim, unmount } = await renderLoaded();
    await startClaim();
    expect(fetchRewards).toHaveBeenCalledTimes(2);

    rerender({ user: OTHER_USER });
    await flush();
    await advance(POLL_WINDOW_MS);

    expect(fetchRewards).toHaveBeenCalledTimes(3);
    expect(fetchRewards).toHaveBeenLastCalledWith(OTHER_USER, CHAIN_ID, undefined);
    unmount();
  });

  it("reports a claim mined after the change but leaves the new wallet's rewards alone", async () => {
    const receipt = deferred<{ status: string }>();
    waitForReceipt.mockReturnValueOnce(receipt.promise);
    fetchRewards.mockResolvedValueOnce(otherWallet);
    const { result, rerender, startClaim, unmount } = await renderLoaded();
    await startClaim();

    rerender({ user: OTHER_USER });
    await flush();
    receipt.resolve({ status: "success" });
    await flush();

    expect(notifyMerklClaimSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.merklRewards).toBe(otherWallet);
    expect(result.current.claimSuccess).toBe(false);
    expect(result.current.isClaiming).toBe(false);
    expect(result.current.isReconcilingAfterClaim).toBe(false);
    // The load for each wallet, and no poll.
    expect(fetchRewards).toHaveBeenCalledTimes(2);
    unmount();
  });
});
