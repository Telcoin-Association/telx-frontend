/**
 * @jest-environment node
 */
import type { CollectPlan } from "@/lib/v4/collect";
import { positionManagerAbi } from "@/lib/v4/positionManager";
import type { Hash } from "viem";
import { MERKL_DISTRIBUTOR_ADDRESS, TEL_TOKEN_ADDRESS } from "@/merkl/merklConstants";
import type { FetchMerklRewardsResult } from "@/merkl/merklTypes";
import { OLD_POOLS_REGISTRY } from "./claimCore";
import { buildClaimPlan, claimRowInputs, type ClaimRow } from "./claimPlan";
import { runClaimPlan, runClaimRow, type ClaimClients, type ClaimDecision, type ClaimRowDeps, type ClaimRowStatus } from "./claimRunner";

const USER = "0x00000000000000000000000000000000000000Aa";
const PROOF = `0x${"11".repeat(32)}` as Hash;
const hashFor = (n: number) => `0x${String(n).padStart(64, "0")}` as Hash;

function merklResult(claimableWei: bigint): FetchMerklRewardsResult {
  const reward = {
    amount: String(claimableWei),
    claimed: "0",
    pending: "0",
    claimable: String(claimableWei),
    tokenAddress: TEL_TOKEN_ADDRESS,
    tokenSymbol: "TEL",
    tokenName: "Telcoin",
    tokenDecimals: 18,
    amountUSD: 0,
    claimedUSD: 0,
    claimableUSD: 0,
    pendingUSD: 0,
    proofs: [PROOF],
    isClaimable: claimableWei > 0n,
    raw: {} as never,
  };
  const claimableRewards = claimableWei > 0n ? [reward] : [];
  return {
    raw: [],
    isEmpty: claimableWei === 0n,
    summary: {
      rewards: claimableRewards,
      totalAmount: String(claimableWei),
      totalClaimed: "0",
      totalClaimable: String(claimableWei),
      totalPending: "0",
      totalAmountUSD: 0,
      totalClaimedUSD: 0,
      totalClaimableUSD: 0,
      totalPendingUSD: 0,
      totalProofsCount: claimableRewards.length,
      claimableRewards,
    },
  };
}

/** A wallet on `startChain`, with every claim succeeding unless a test says otherwise. */
function makeDeps(startChain = 137) {
  let chain = startChain;
  let sent = 0;
  const publicClient = {
    simulateContract: jest.fn(async () => ({})),
    waitForTransactionReceipt: jest.fn(async () => ({ status: "success" })),
    estimateContractGas: jest.fn(),
    getGasPrice: jest.fn(),
  };
  const walletClient = { writeContract: jest.fn(async () => hashFor(++sent)) };
  const deps = {
    account: USER,
    currentChainId: () => chain,
    switchChain: jest.fn(async (target: number) => {
      chain = target;
    }),
    waitForChain: jest.fn(async (target: number) => {
      chain = target;
    }),
    isUserRejection: (error: unknown) => (error as { code?: number })?.code === 4001,
    fetchMerkl: jest.fn(async () => merklResult(5n * 10n ** 18n)),
    readOldPools: jest.fn(async () => 1234n),
    readCollect: jest.fn(async (): Promise<CollectPlan | null> => COLLECT_PLAN),
    getClients: jest.fn(async () => ({ publicClient, walletClient }) as unknown as ClaimClients),
  } satisfies ClaimRowDeps;
  return { deps, publicClient, walletClient };
}

const plan = (currentChainId?: number) =>
  buildClaimPlan(claimRowInputs({ polygon: 5, base: 3 }, { polygon: 12.34 }), { currentChainId, telUsd: 0.002 });

function recorder() {
  const log: [string, ClaimRowStatus][] = [];
  return { log, onStatus: (rowId: string, status: ClaimRowStatus) => log.push([rowId, status]) };
}

const COLLECT_PLAN: CollectPlan = {
  tokenIds: [144097n],
  amounts: [
    { currency: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", symbol: "WETH", decimals: 18, amount: 10n ** 15n },
    { currency: "0x7e13b43065380acdec1c2d138c579cbbbafa0731", symbol: "TEL", decimals: 18, amount: 5n * 10n ** 18n },
  ],
  request: { address: "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9", abi: positionManagerAbi, functionName: "modifyLiquidities", args: ["0x01", 1n] },
};

const TARGETS = [{ tokenId: "144097", poolId: "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d" as const, tickLower: 136620, tickUpper: 150480 }];

describe("fees rows", () => {
  const feesPlan = () =>
    buildClaimPlan(claimRowInputs({ polygon: 5 }, {}, { polygon: { targets: TARGETS, summary: "0.001 WETH · 5 TEL", valueUsd: 3.03 } }), { currentChainId: 137, telUsd: 0.002 });

  it("collects the chain's fees with the call read fresh before the prompt, and names what it collected", async () => {
    const { deps, publicClient, walletClient } = makeDeps(137);
    const row = feesPlan().find((r) => r.id === "fees:polygon") as ClaimRow;
    expect(row).toMatchObject({ kind: "fees", valueUsd: 3.03, checked: true });
    const statuses: ClaimRowStatus[] = [];

    const outcome = await runClaimRow(row, deps, (s) => statuses.push(s), new AbortController().signal);

    expect(deps.readCollect).toHaveBeenCalledWith("polygon", TARGETS);
    expect(publicClient.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "modifyLiquidities", account: USER }));
    expect(walletClient.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "modifyLiquidities", address: COLLECT_PLAN.request.address }));
    expect(statuses).toContainEqual({ state: "confirm", amountTel: 0, summary: "0.001 WETH and 5 TEL" });
    expect(outcome).toMatchObject({ kind: "claimed", amountTel: 0, summary: "0.001 WETH and 5 TEL" });
  });

  it("skips a fees row with nothing owed by the time it runs", async () => {
    const { deps, walletClient } = makeDeps(137);
    deps.readCollect.mockResolvedValue(null);
    const row = feesPlan().find((r) => r.id === "fees:polygon") as ClaimRow;
    await expect(runClaimRow(row, deps, () => undefined, new AbortController().signal)).resolves.toEqual({ kind: "nothing" });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("starts a fees row unchecked when its network fee is more than the fees are worth", () => {
    const plan = buildClaimPlan(claimRowInputs({}, {}, { base: { targets: TARGETS, summary: "0.00001 ETH", valueUsd: 0.03 } }), { telUsd: 0.002, feesUsd: { "fees:base": 0.05 } });
    expect(plan[0]).toMatchObject({ id: "fees:base", uneconomic: true, checked: false });
  });
});

describe("runClaimRow", () => {
  const row = (id: string, currentChainId = 137) => plan(currentChainId).find((r) => r.id === id) as ClaimRow;

  it("claims on the current chain without asking the wallet to switch, with fresh proofs and a simulation first", async () => {
    const { deps, publicClient, walletClient } = makeDeps(137);
    const statuses: ClaimRowStatus[] = [];
    const outcome = await runClaimRow(row("merkl:polygon"), deps, (s) => statuses.push(s), new AbortController().signal);

    expect(outcome).toEqual({ kind: "claimed", hash: hashFor(1), amountTel: 5 });
    expect(deps.switchChain).not.toHaveBeenCalled();
    expect(deps.fetchMerkl).toHaveBeenCalledWith(137);
    expect(publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: MERKL_DISTRIBUTOR_ADDRESS, functionName: "claim", account: USER, args: [[USER], [TEL_TOKEN_ADDRESS], [5n * 10n ** 18n], [[PROOF]]] })
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "claim", chain: expect.objectContaining({ id: 137 }) }));
    expect(statuses.map((s) => s.state)).toEqual(["preparing", "confirm", "confirming"]);
  });

  it("sends and shows the amount read just before the prompt when it changed since the plan was built", async () => {
    const { deps, walletClient } = makeDeps(137);
    // The plan says 5 TEL on Polygon; Merkl now reports 7.
    deps.fetchMerkl.mockResolvedValue(merklResult(7n * 10n ** 18n));
    const statuses: ClaimRowStatus[] = [];
    const outcome = await runClaimRow(row("merkl:polygon"), deps, (s) => statuses.push(s), new AbortController().signal);

    expect(statuses.find((s) => s.state === "confirm")).toEqual({ state: "confirm", amountTel: 7 });
    expect(walletClient.writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [[USER], [TEL_TOKEN_ADDRESS], [7n * 10n ** 18n], [[PROOF]]] }));
    expect(outcome).toEqual({ kind: "claimed", hash: hashFor(1), amountTel: 7 });
  });

  it("switches the wallet to the row's chain first", async () => {
    const { deps } = makeDeps(137);
    const statuses: ClaimRowStatus[] = [];
    await runClaimRow(row("merkl:base"), deps, (s) => statuses.push(s), new AbortController().signal);
    expect(deps.switchChain).toHaveBeenCalledWith(8453);
    expect(statuses[0]).toEqual({ state: "switching" });
  });

  it("fails the row when the visitor declines the switch, without sending anything", async () => {
    const { deps, walletClient } = makeDeps(137);
    deps.switchChain.mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: 4001 }));
    const outcome = await runClaimRow(row("merkl:base"), deps, () => {}, new AbortController().signal);
    expect(outcome).toEqual({ kind: "failed", reason: "The switch to Base was declined in the wallet." });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("waits for a hand-made switch when the wallet can't switch on request", async () => {
    const { deps } = makeDeps(137);
    deps.switchChain.mockRejectedValueOnce(Object.assign(new Error("Method not supported"), { code: 4200 }));
    const statuses: ClaimRowStatus[] = [];
    const outcome = await runClaimRow(row("merkl:base"), deps, (s) => statuses.push(s), new AbortController().signal);
    expect(statuses.map((s) => s.state)).toContain("manualSwitch");
    expect(deps.waitForChain).toHaveBeenCalledWith(8453, expect.anything());
    expect(outcome.kind).toBe("claimed");
  });

  it("claims the old pools from the registry, reading the latest amount there", async () => {
    const { deps, walletClient } = makeDeps(137);
    const outcome = await runClaimRow(row("oldPools:polygon"), deps, () => {}, new AbortController().signal);
    expect(deps.readOldPools).toHaveBeenCalledWith("polygon");
    expect(walletClient.writeContract).toHaveBeenCalledWith(expect.objectContaining({ address: OLD_POOLS_REGISTRY.polygon, functionName: "claim" }));
    expect(outcome).toEqual({ kind: "claimed", hash: hashFor(1), amountTel: 12.34 });
  });

  it("reports nothing to claim when the fresh read is empty, without a prompt", async () => {
    const { deps, walletClient } = makeDeps(137);
    deps.fetchMerkl.mockResolvedValueOnce(merklResult(0n));
    expect(await runClaimRow(row("merkl:polygon"), deps, () => {}, new AbortController().signal)).toEqual({ kind: "nothing" });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("stops at a failing simulation with its reason, and never prompts the wallet", async () => {
    const { deps, publicClient, walletClient } = makeDeps(137);
    publicClient.simulateContract.mockRejectedValueOnce(Object.assign(new Error("x"), { shortMessage: "Invalid proof" }));
    expect(await runClaimRow(row("merkl:polygon"), deps, () => {}, new AbortController().signal)).toEqual({
      kind: "failed",
      reason: "The claim would fail: Invalid proof",
    });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("reports a rejected signature and a reverted claim, the latter with its transaction", async () => {
    const { deps, walletClient, publicClient } = makeDeps(137);
    walletClient.writeContract.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: 4001 }));
    expect(await runClaimRow(row("merkl:polygon"), deps, () => {}, new AbortController().signal)).toEqual({
      kind: "failed",
      reason: "The claim was rejected in the wallet.",
    });

    publicClient.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    const reverted = await runClaimRow(row("merkl:polygon"), deps, () => {}, new AbortController().signal);
    expect(reverted).toEqual({ kind: "failed", reason: "The claim reverted on chain, so nothing was claimed.", hash: hashFor(1) });
  });
});

describe("runClaimPlan", () => {
  it("claims every row in turn, switching the wallet once per chain", async () => {
    const { deps, walletClient } = makeDeps(8453);
    const rows = plan(8453);
    const { onStatus, log } = recorder();
    const claimed = jest.fn();
    const result = await runClaimPlan({ rows, deps, onStatus, awaitDecision: jest.fn(), onClaimed: claimed, signal: new AbortController().signal });

    expect(rows.map((r) => r.id)).toEqual(["merkl:base", "merkl:polygon", "oldPools:polygon"]);
    expect(deps.switchChain.mock.calls).toEqual([[137]]);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ stopped: false, claimed: rows.map((row, i) => ({ row, hash: hashFor(i + 1), amountTel: row.kind === "merkl" ? 5 : 12.34 })) });
    expect(claimed).toHaveBeenCalledTimes(3);
    // Each chain's proofs are read right before its own claim, not all up front.
    expect(deps.fetchMerkl.mock.invocationCallOrder[0]).toBeLessThan(walletClient.writeContract.mock.invocationCallOrder[0]);
    expect(deps.fetchMerkl.mock.invocationCallOrder[1]).toBeGreaterThan(walletClient.writeContract.mock.invocationCallOrder[0]);
    expect(log.filter(([, s]) => s.state === "claimed")).toHaveLength(3);
  });

  it("pauses on a failure, then retries the row when asked", async () => {
    const { deps, walletClient } = makeDeps(8453);
    walletClient.writeContract.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: 4001 }));
    const decisions: ClaimDecision[] = ["retry"];
    const awaitDecision = jest.fn(async () => decisions.shift() as ClaimDecision);
    const { onStatus, log } = recorder();
    const result = await runClaimPlan({ rows: plan(8453), deps, onStatus, awaitDecision, signal: new AbortController().signal });

    expect(awaitDecision).toHaveBeenCalledWith("merkl:base");
    expect(log).toContainEqual(["merkl:base", { state: "failed", reason: "The claim was rejected in the wallet." }]);
    expect(result.claimed.map(({ row }) => row.id)).toEqual(["merkl:base", "merkl:polygon", "oldPools:polygon"]);
  });

  it("skips a failed row and carries on with the next", async () => {
    const { deps } = makeDeps(8453);
    deps.switchChain.mockRejectedValueOnce(Object.assign(new Error("no"), { code: 4001 }));
    const { onStatus, log } = recorder();
    const result = await runClaimPlan({ rows: plan(8453), deps, onStatus, awaitDecision: async () => "skip", signal: new AbortController().signal });

    // The declined switch fails only its own row; the next Polygon row asks again, and that switch goes through.
    expect(result.claimed.map(({ row }) => row.id)).toEqual(["merkl:base", "oldPools:polygon"]);
    expect(log.filter(([, s]) => s.state === "skipped").map(([id]) => id)).toEqual(["merkl:polygon"]);
    expect(result.stopped).toBe(false);
  });

  it("stops when asked, keeping what was claimed and marking the rest as skipped", async () => {
    const { deps, publicClient } = makeDeps(8453);
    publicClient.simulateContract.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("bad"));
    const { onStatus, log } = recorder();
    const result = await runClaimPlan({ rows: plan(8453), deps, onStatus, awaitDecision: async () => "stop", signal: new AbortController().signal });

    expect(result.stopped).toBe(true);
    expect(result.claimed.map(({ row }) => row.id)).toEqual(["merkl:base"]);
    expect(log.at(-1)).toEqual(["oldPools:polygon", { state: "skipped", reason: "Stopped before this claim." }]);
  });

  it("stops after the current claim once the signal is aborted", async () => {
    const { deps, walletClient } = makeDeps(8453);
    const controller = new AbortController();
    const result = await runClaimPlan({
      rows: plan(8453),
      deps,
      onStatus: () => {},
      awaitDecision: jest.fn(),
      onClaimed: () => controller.abort(),
      signal: controller.signal,
    });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ stopped: true, claimed: [expect.objectContaining({ hash: hashFor(1) })] });
  });
});
