/** @jest-environment node */
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  HttpRequestError,
  toEventSelector,
  TransactionReceiptNotFoundError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hex,
} from "viem";
import { vaultAbi } from "./abis";
import { VAULT_DEPLOYMENTS, VAULT_CHAIN_IDS, routeFor } from "./deployments";
import { ReceiptVerificationError, TransactionReplacedError } from "./errors";
import {
  approvalPostStateSatisfied,
  assertNotReplaced,
  classifyWaitError,
  confirmationsForChain,
  verifyVaultReceipt,
} from "./receiptVerification";
import { POLYGON_BUY_GEM_SWAP, POLYGON_SELL_GEM_SWAP, type RecordedSwap } from "./testing/polygonSwapReceipt";
import {
  TEST_TX_HASH,
  TEST_WALLET,
  approvalLog,
  approveReceiptFor,
  buildPendingApproveRecord,
  buildPendingSwapRecord,
  buildReceipt,
  swapLog,
  swapReceiptFor,
  transferLog,
  type ReceiptLog,
} from "./testing/receipts";
import type { PendingSwapRecord, SwapDirection, VaultPendingRecord } from "./types";

const SWAP_TOPIC = "0xdba43ee9916cb156cc32a5d3406e87341e568126a46815294073ba25c9400246";
const STRANGER: Address = "0x6666666666666666666666666666666666666666";
const SMART_ACCOUNT_ENTRY: Address = "0x7777777777777777777777777777777777777777";
const DIRECTIONS: readonly SwapDirection[] = ["usdcToEusd", "eusdToUsdc"];
const REVERTED_SWAP_COPY =
  "This swap transaction reverted. It did not move any funds. Check your balances before trying again.";

const erc721Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "approved", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

/** An ERC-721 Transfer: the ERC-20 selector, three indexed topics and no data. */
function erc721TransferLog(token: Address, from: Address, to: Address, tokenId: bigint): ReceiptLog {
  const topics = encodeEventTopics({ abi: erc721Abi, eventName: "Transfer", args: { from, to, tokenId } });
  return { ...transferLog(token, from, to, 0n), topics: topics as [Hex, ...Hex[]], data: "0x" };
}

/** An ERC-721 Approval: the ERC-20 selector, three indexed topics and no data. */
function erc721ApprovalLog(token: Address, owner: Address, approved: Address, tokenId: bigint): ReceiptLog {
  const topics = encodeEventTopics({ abi: erc721Abi, eventName: "Approval", args: { owner, approved, tokenId } });
  return { ...approvalLog(token, owner, approved, 0n), topics: topics as [Hex, ...Hex[]], data: "0x" };
}

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function reasonOf(fn: () => unknown) {
  const error = errorOf(fn);
  if (error === undefined) return undefined;
  if (error instanceof ReceiptVerificationError) return error.reason;
  throw error;
}

function verify(record: VaultPendingRecord, logs: readonly ReceiptLog[]) {
  return verifyVaultReceipt({ record, receipt: buildReceipt({ logs }) });
}

/** The three logs of a swap, as the vault emits them, with any field of the `Swap` changed. */
function swapLogsFor(record: PendingSwapRecord, swap: Partial<Parameters<typeof swapLog>[1]> & { vault?: Address } = {}) {
  const { vault = record.vault, ...args } = swap;
  const amountOut = args.amountOut ?? record.quotedOut;
  return {
    transferIn: transferLog(record.tokenIn, record.address, record.vault, record.amountIn),
    transferOut: transferLog(record.tokenOut, record.vault, record.address, amountOut),
    swap: swapLog(vault, {
      sender: record.address,
      recipient: record.address,
      tokenIn: record.tokenIn,
      tokenOut: record.tokenOut,
      amountIn: record.amountIn,
      fee: record.quotedFee,
      ...args,
      amountOut,
    }),
  };
}

describe("verifyVaultReceipt: approve", () => {
  const record = buildPendingApproveRecord();

  it("accepts an Approval for exactly the amount", () => {
    expect(verifyVaultReceipt({ record, receipt: approveReceiptFor(record) })).toEqual({ kind: "approve" });
  });

  it("accepts an Approval for more than the amount, as when the wallet let the user raise the cap", () => {
    expect(verifyVaultReceipt({ record, receipt: approveReceiptFor(record, { value: record.amountIn + 1n }) })).toEqual(
      { kind: "approve" }
    );
    expect(
      verifyVaultReceipt({ record, receipt: approveReceiptFor(record, { value: 2n ** 256n - 1n }) })
    ).toEqual({ kind: "approve" });
  });

  it("reports post-state for an Approval below the amount, as when the wallet let the user lower the cap", () => {
    expect(reasonOf(() => verifyVaultReceipt({ record, receipt: approveReceiptFor(record, { value: record.amountIn - 1n }) }))).toBe(
      "post-state"
    );
    expect(reasonOf(() => verifyVaultReceipt({ record, receipt: approveReceiptFor(record, { value: 0n }) }))).toBe(
      "post-state"
    );
  });

  it("takes the last matching Approval when a batch approves more than once", () => {
    const approve = (value: bigint) => approvalLog(record.tokenIn, record.address, record.vault, value);
    expect(verify(record, [approve(0n), approve(record.amountIn)])).toEqual({ kind: "approve" });
    expect(reasonOf(() => verify(record, [approve(record.amountIn), approve(0n)]))).toBe("post-state");
  });

  it("rejects a receipt without an Approval log", () => {
    expect(reasonOf(() => verify(record, []))).toBe("missing-event");
  });

  it("rejects an Approval for another spender", () => {
    expect(reasonOf(() => verify(record, [approvalLog(record.tokenIn, record.address, STRANGER, record.amountIn)]))).toBe(
      "missing-event"
    );
  });

  it("rejects an Approval from another owner", () => {
    expect(reasonOf(() => verify(record, [approvalLog(record.tokenIn, STRANGER, record.vault, record.amountIn)]))).toBe(
      "missing-event"
    );
  });

  it("ignores an Approval emitted by the other vault token or another contract", () => {
    for (const token of [record.tokenOut, STRANGER]) {
      expect(reasonOf(() => verify(record, [approvalLog(token, record.address, record.vault, record.amountIn)]))).toBe(
        "missing-event"
      );
    }
  });

  it("ignores an ERC-721 Approval with the same selector from the token without throwing", () => {
    const nft = erc721ApprovalLog(record.tokenIn, record.address, record.vault, record.amountIn);
    expect(nft.topics).toHaveLength(4);
    expect(reasonOf(() => verify(record, [nft]))).toBe("missing-event");
    expect(verify(record, [nft, approvalLog(record.tokenIn, record.address, record.vault, record.amountIn)])).toEqual({
      kind: "approve",
    });
    // Nor does it count as the Approval that stands.
    const lowered = approvalLog(record.tokenIn, record.address, record.vault, record.amountIn - 1n);
    expect(reasonOf(() => verify(record, [lowered, nft]))).toBe("post-state");
  });

  it("rejects a reverted approval", () => {
    const error = errorOf(() => verifyVaultReceipt({ record, receipt: approveReceiptFor(record, { status: "reverted" }) }));
    expect(error).toBeInstanceOf(ReceiptVerificationError);
    expect(error).toMatchObject({ kind: "approve", reason: "reverted" });
  });

  it("accepts each direction's input token on every chain", () => {
    for (const chainId of VAULT_CHAIN_IDS) {
      for (const direction of DIRECTIONS) {
        const r = buildPendingApproveRecord({ chainId, direction });
        expect(r.tokenIn).toBe(routeFor(VAULT_DEPLOYMENTS[chainId], direction).tokenIn);
        expect(verifyVaultReceipt({ record: r, receipt: approveReceiptFor(r) })).toEqual({ kind: "approve" });
      }
    }
  });
});

describe("verifyVaultReceipt: swap", () => {
  const record = buildPendingSwapRecord({ amountIn: 250_000_000n, quotedOut: 249_750_000n, quotedFee: 250_000n });

  it.each(DIRECTIONS)("accepts a %s swap and returns the amounts from Swap", (direction) => {
    const r = buildPendingSwapRecord({ direction, amountIn: 1_000_000n, quotedOut: 1_000_000n, quotedFee: 0n });
    expect(verifyVaultReceipt({ record: r, receipt: swapReceiptFor(r) })).toEqual({
      kind: "swap",
      swap: { amountIn: 1_000_000n, amountOut: 1_000_000n, fee: 0n },
    });
  });

  it("accepts both directions on every chain", () => {
    for (const chainId of VAULT_CHAIN_IDS) {
      for (const direction of DIRECTIONS) {
        const r = buildPendingSwapRecord({ chainId, direction });
        expect(verifyVaultReceipt({ record: r, receipt: swapReceiptFor(r) })).toMatchObject({ kind: "swap" });
      }
    }
  });

  it("accepts a fee without a fee Transfer and returns it", () => {
    expect(verifyVaultReceipt({ record, receipt: swapReceiptFor(record) })).toEqual({
      kind: "swap",
      swap: { amountIn: 250_000_000n, amountOut: 249_750_000n, fee: 250_000n },
    });
  });

  it("accepts a fee with a fee Transfer", () => {
    const receipt = swapReceiptFor(record, { feeRecipient: STRANGER });
    expect(receipt.logs).toHaveLength(4);
    expect(verifyVaultReceipt({ record, receipt })).toEqual({
      kind: "swap",
      swap: { amountIn: 250_000_000n, amountOut: 249_750_000n, fee: 250_000n },
    });
  });

  it("verifies when amountOut differs from the quote and returns the actual amount", () => {
    for (const amountOut of [record.quotedOut - 1n, record.quotedOut + 1n, 1n]) {
      expect(verifyVaultReceipt({ record, receipt: swapReceiptFor(record, { amountOut, fee: 7n }) })).toEqual({
        kind: "swap",
        swap: { amountIn: record.amountIn, amountOut, fee: 7n },
      });
    }
  });

  it("rejects a Swap with no output", () => {
    const { transferIn, transferOut, swap } = swapLogsFor(record, { amountOut: 0n });
    expect(reasonOf(() => verify(record, [transferIn, transferOut, swap]))).toBe("missing-event");
  });

  it("rejects a reverted swap with the no-funds-moved copy", () => {
    const error = errorOf(() => verifyVaultReceipt({ record, receipt: swapReceiptFor(record, { status: "reverted" }) }));
    expect(error).toBeInstanceOf(ReceiptVerificationError);
    expect(error).toMatchObject({ kind: "swap", reason: "reverted", message: REVERTED_SWAP_COPY });
  });

  it("does not care where the outer transaction was addressed", () => {
    // A smart account executes through its own contract, and a bundler may send it, so receipt.to and receipt.from
    // are neither the wallet nor the vault while the call is exactly the one requested. The logs are the proof.
    for (const to of [SMART_ACCOUNT_ENTRY, record.address, null]) {
      expect(
        verifyVaultReceipt({ record, receipt: swapReceiptFor(record, { to, from: STRANGER }) })
      ).toMatchObject({ kind: "swap" });
    }
    const approve = buildPendingApproveRecord();
    expect(verifyVaultReceipt({ record: approve, receipt: approveReceiptFor(approve, { to: SMART_ACCOUNT_ENTRY }) })).toEqual(
      { kind: "approve" }
    );
  });

  it("requires the Swap to come from the vault", () => {
    const { transferIn, transferOut, swap } = swapLogsFor(record, { vault: STRANGER });
    expect(reasonOf(() => verify(record, [transferIn, transferOut, swap]))).toBe("missing-event");
  });

  it("requires the wallet as both sender and recipient", () => {
    for (const other of [{ sender: STRANGER }, { recipient: STRANGER }, { sender: STRANGER, recipient: STRANGER }]) {
      const { transferIn, transferOut, swap } = swapLogsFor(record, other);
      expect(reasonOf(() => verify(record, [transferIn, transferOut, swap]))).toBe("missing-event");
    }
  });

  it("rejects a Swap whose token fields are swapped or name another token", () => {
    for (const tokens of [
      { tokenIn: record.tokenOut, tokenOut: record.tokenIn },
      { tokenIn: STRANGER },
      { tokenOut: STRANGER },
    ]) {
      const { transferIn, transferOut, swap } = swapLogsFor(record, tokens);
      expect(reasonOf(() => verify(record, [transferIn, transferOut, swap]))).toBe("missing-event");
    }
  });

  it("rejects a Swap for another amountIn", () => {
    for (const amountIn of [record.amountIn - 1n, record.amountIn + 1n]) {
      const { transferIn, transferOut, swap } = swapLogsFor(record, { amountIn });
      expect(reasonOf(() => verify(record, [transferIn, transferOut, swap]))).toBe("missing-event");
      // Even when a Transfer in corroborates the other amount.
      const other = transferLog(record.tokenIn, record.address, record.vault, amountIn);
      expect(reasonOf(() => verify(record, [other, transferOut, swap]))).toBe("missing-event");
    }
  });

  it("requires the input Transfer from the wallet to the vault, of amountIn, emitted by the input token", () => {
    const { transferOut, swap } = swapLogsFor(record);
    const variants: ReadonlyArray<readonly [string, ReceiptLog[]]> = [
      ["missing", []],
      ["another sender", [transferLog(record.tokenIn, STRANGER, record.vault, record.amountIn)]],
      ["another recipient", [transferLog(record.tokenIn, record.address, STRANGER, record.amountIn)]],
      ["another amount", [transferLog(record.tokenIn, record.address, record.vault, record.amountIn - 1n)]],
      ["zero", [transferLog(record.tokenIn, record.address, record.vault, 0n)]],
      ["the output token", [transferLog(record.tokenOut, record.address, record.vault, record.amountIn)]],
    ];
    for (const [label, transferIn] of variants) {
      expect([label, reasonOf(() => verify(record, [...transferIn, transferOut, swap]))]).toEqual([
        label,
        "missing-event",
      ]);
    }
  });

  it("requires the output Transfer from the vault to the wallet, of Swap.amountOut, emitted by the output token", () => {
    const { transferIn, swap } = swapLogsFor(record);
    const out = record.quotedOut;
    const variants: ReadonlyArray<readonly [string, ReceiptLog[]]> = [
      ["missing", []],
      ["another sender", [transferLog(record.tokenOut, STRANGER, record.address, out)]],
      ["another recipient", [transferLog(record.tokenOut, record.vault, STRANGER, out)]],
      ["less than Swap.amountOut", [transferLog(record.tokenOut, record.vault, record.address, out - 1n)]],
      ["more than Swap.amountOut", [transferLog(record.tokenOut, record.vault, record.address, out + 1n)]],
      ["the input token", [transferLog(record.tokenIn, record.vault, record.address, out)]],
    ];
    for (const [label, transferOut] of variants) {
      expect([label, reasonOf(() => verify(record, [transferIn, ...transferOut, swap]))]).toEqual([
        label,
        "missing-event",
      ]);
    }
    // The output Transfer matches the quote but the Swap reports another amount.
    const moved = swapLogsFor(record, { amountOut: out - 5n });
    const quotedTransfer = transferLog(record.tokenOut, record.vault, record.address, out);
    expect(reasonOf(() => verify(record, [moved.transferIn, quotedTransfer, moved.swap]))).toBe("missing-event");
  });

  it("rejects a receipt with the Transfers but no Swap", () => {
    const { transferIn, transferOut } = swapLogsFor(record);
    expect(reasonOf(() => verify(record, [transferIn, transferOut]))).toBe("missing-event");
  });

  it("picks the Swap that matches the record among several", () => {
    const ours = swapLogsFor(record, { amountOut: 249_000_000n, fee: 1_000_000n });
    const otherWallet = swapLogsFor(buildPendingSwapRecord({ address: STRANGER }));
    const otherVault = swapLogsFor(record, { vault: STRANGER, amountOut: 1n });
    const otherDirection = swapLogsFor(buildPendingSwapRecord({ direction: "eusdToUsdc" }));
    const logs = [
      otherWallet.transferIn,
      otherWallet.transferOut,
      otherWallet.swap,
      otherVault.swap,
      otherDirection.swap,
      ours.transferIn,
      ours.transferOut,
      ours.swap,
    ];
    expect(verify(record, logs)).toEqual({
      kind: "swap",
      swap: { amountIn: record.amountIn, amountOut: 249_000_000n, fee: 1_000_000n },
    });
  });

  it("skips a matching Swap that no output Transfer corroborates in favour of one that is", () => {
    const uncorroborated = swapLogsFor(record, { amountOut: 5n });
    const ours = swapLogsFor(record);
    expect(verify(record, [uncorroborated.swap, ours.transferIn, ours.transferOut, ours.swap])).toEqual({
      kind: "swap",
      swap: { amountIn: record.amountIn, amountOut: record.quotedOut, fee: record.quotedFee },
    });
  });

  it("ignores unrelated Transfers from the wallet and takes the amounts from Swap", () => {
    const { transferIn, transferOut, swap } = swapLogsFor(record);
    const unrelated = [
      transferLog(record.tokenIn, record.address, STRANGER, 1n),
      transferLog(record.tokenOut, record.address, STRANGER, 2n),
    ];
    expect(verify(record, [...unrelated, transferIn, transferOut, swap])).toEqual({
      kind: "swap",
      swap: { amountIn: record.amountIn, amountOut: record.quotedOut, fee: record.quotedFee },
    });
  });

  it("strictly parses logs: an ERC-721 Transfer with the same selector from the token is ignored without throwing", () => {
    const { transferIn, transferOut, swap } = swapLogsFor(record);
    const nftIn = erc721TransferLog(record.tokenIn, record.address, record.vault, record.amountIn);
    const nftOut = erc721TransferLog(record.tokenOut, record.vault, record.address, record.quotedOut);
    expect(nftIn.topics).toHaveLength(4);
    expect(nftIn.topics[0]).toBe(transferIn.topics[0]);

    expect(verify(record, [nftIn, transferIn, nftOut, transferOut, swap])).toMatchObject({ kind: "swap" });
    expect(reasonOf(() => verify(record, [nftIn, transferOut, swap]))).toBe("missing-event");
    expect(reasonOf(() => verify(record, [transferIn, nftOut, swap]))).toBe("missing-event");
  });

  it("strictly parses logs: a Transfer with the same selector but no indexed arguments is ignored without throwing", () => {
    const { transferIn, transferOut, swap } = swapLogsFor(record);
    const unindexed: ReceiptLog = {
      ...transferIn,
      topics: [transferIn.topics[0] as Hex],
      data: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [record.address, record.vault, record.amountIn]
      ),
    };
    expect(reasonOf(() => verify(record, [unindexed, transferOut, swap]))).toBe("missing-event");
    expect(verify(record, [unindexed, transferIn, transferOut, swap])).toMatchObject({ kind: "swap" });
  });

  it("skips a Swap log whose data does not decode", () => {
    const { transferIn, transferOut, swap } = swapLogsFor(record);
    const truncated: ReceiptLog = { ...swap, data: swap.data.slice(0, 2 + 64 * 2) as Hex };
    expect(reasonOf(() => verify(record, [transferIn, transferOut, truncated]))).toBe("missing-event");
    expect(verify(record, [transferIn, transferOut, truncated, swap])).toMatchObject({ kind: "swap" });
  });

  it("matches lowercase, uppercase and checksummed addresses", () => {
    // Logs carry lowercase addresses (as an RPC returns them); the record may hold any casing.
    const lower = (a: Address) => a.toLowerCase() as Address;
    const upper = (a: Address) => `0x${a.slice(2).toUpperCase()}` as Address;
    const wallet: Address = "0xabcdef0123456789abcdef0123456789abcdef01";
    const swap = buildPendingSwapRecord({ address: wallet });
    const swapLogged = { ...swap, vault: lower(swap.vault), tokenIn: lower(swap.tokenIn), tokenOut: lower(swap.tokenOut) };
    const swapRecord = { ...swap, address: upper(wallet), vault: upper(swap.vault), tokenIn: upper(swap.tokenIn) };
    expect(verifyVaultReceipt({ record: swapRecord, receipt: swapReceiptFor(swapLogged) })).toMatchObject({
      kind: "swap",
    });

    const approve = buildPendingApproveRecord({ address: wallet });
    const approveLogged = { ...approve, vault: lower(approve.vault), tokenIn: lower(approve.tokenIn) };
    const approveRecord = { ...approve, address: upper(wallet), vault: upper(approve.vault) };
    expect(verifyVaultReceipt({ record: approveRecord, receipt: approveReceiptFor(approveLogged) })).toEqual({
      kind: "approve",
    });
  });
});

describe("the Swap event", () => {
  it("has the topic0 the deployed vault emits", () => {
    expect(toEventSelector(getAbiItem({ abi: vaultAbi, name: "Swap" }))).toBe(SWAP_TOPIC);
    const record = buildPendingSwapRecord();
    expect(swapReceiptFor(record).logs.at(-1)?.topics[0]).toBe(SWAP_TOPIC);
    for (const recorded of [POLYGON_SELL_GEM_SWAP, POLYGON_BUY_GEM_SWAP]) {
      expect(recorded.receipt.logs.filter((log) => log.topics[0] === SWAP_TOPIC)).toHaveLength(1);
    }
  });
});

describe("verifyVaultReceipt: recorded Polygon swaps", () => {
  function recordFor(recorded: RecordedSwap, address: Address = recorded.wallet): PendingSwapRecord {
    return buildPendingSwapRecord({
      chainId: 137,
      direction: recorded.direction,
      address,
      amountIn: recorded.amountIn,
      quotedOut: recorded.amountOut,
      quotedFee: recorded.fee,
      hash: recorded.receipt.transactionHash,
    });
  }

  it("formats the recorded receipts", () => {
    expect(POLYGON_SELL_GEM_SWAP.receipt).toMatchObject({
      status: "success",
      blockNumber: 94_673_033n,
      transactionHash: "0xbb33cbd7ee4bdd1c6227dbcac09e6a2c4dbee951afd14189938734a25c753769",
    });
    expect(POLYGON_BUY_GEM_SWAP.receipt).toMatchObject({
      status: "success",
      blockNumber: 94_110_592n,
      transactionHash: "0xcc4e133871cd08db0be9b0c4bbfc104021fdc8ee4ba7891af615d1a2bfbbdaa5",
    });
    expect(POLYGON_SELL_GEM_SWAP.receipt.logs).toHaveLength(4);
    expect(POLYGON_BUY_GEM_SWAP.receipt.logs).toHaveLength(4);
  });

  it("verifies the recorded sellGem swap and returns exactly the recorded amounts", () => {
    const recorded = POLYGON_SELL_GEM_SWAP;
    expect(recorded.direction).toBe("usdcToEusd");
    expect(verifyVaultReceipt({ record: recordFor(recorded), receipt: recorded.receipt })).toEqual({
      kind: "swap",
      swap: { amountIn: 372_275_685n, amountOut: 372_275_685n, fee: 0n },
    });
  });

  it("verifies the recorded buyGem swap and returns exactly the recorded amounts", () => {
    const recorded = POLYGON_BUY_GEM_SWAP;
    expect(recorded.direction).toBe("eusdToUsdc");
    expect(verifyVaultReceipt({ record: recordFor(recorded), receipt: recorded.receipt })).toEqual({
      kind: "swap",
      swap: { amountIn: 137_217_895n, amountOut: 137_217_895n, fee: 0n },
    });
  });

  it.each([
    ["sellGem", POLYGON_SELL_GEM_SWAP],
    ["buyGem", POLYGON_BUY_GEM_SWAP],
  ] as const)("rejects the recorded %s receipt for a record of another wallet", (_, recorded) => {
    expect(reasonOf(() => verifyVaultReceipt({ record: recordFor(recorded, TEST_WALLET), receipt: recorded.receipt }))).toBe(
      "missing-event"
    );
  });
});

describe("approvalPostStateSatisfied", () => {
  it("requires the allowance to cover the amount", () => {
    expect(approvalPostStateSatisfied(5n, 5n)).toBe(true);
    expect(approvalPostStateSatisfied(6n, 5n)).toBe(true);
    expect(approvalPostStateSatisfied(4n, 5n)).toBe(false);
    expect(approvalPostStateSatisfied(0n, 0n)).toBe(true);
  });
});

describe("assertNotReplaced", () => {
  it("passes when there was no replacement or only a repricing", () => {
    expect(() => assertNotReplaced("approve", undefined)).not.toThrow();
    expect(() => assertNotReplaced("swap", { reason: "repriced" })).not.toThrow();
  });

  it("throws for a cancelled or replaced transaction", () => {
    expect(() => assertNotReplaced("approve", { reason: "cancelled" })).toThrow(TransactionReplacedError);
    expect(() => assertNotReplaced("swap", { reason: "replaced" })).toThrow(
      "The swap transaction was replaced by another transaction from your wallet."
    );

    const cancelled = errorOf(() => assertNotReplaced("swap", { reason: "cancelled" }));
    expect(cancelled).toBeInstanceOf(TransactionReplacedError);
    expect(cancelled).toMatchObject({
      kind: "swap",
      reason: "cancelled",
      tone: "info",
      message: "The swap transaction was cancelled in your wallet. It did not move any funds.",
    });

    const replaced = errorOf(() => assertNotReplaced("approve", { reason: "replaced" }));
    expect(replaced).toMatchObject({ kind: "approve", reason: "replaced", tone: "warning" });
  });
});

describe("confirmationsForChain", () => {
  it("uses the pinned confirmation count", () => {
    expect(confirmationsForChain(137)).toBe(3);
    expect(confirmationsForChain(1)).toBe(1);
    expect(confirmationsForChain(8453)).toBe(1);
    for (const chainId of VAULT_CHAIN_IDS) {
      expect(confirmationsForChain(chainId)).toBe(VAULT_DEPLOYMENTS[chainId].confirmations);
    }
  });

  it("waits for one confirmation on an unknown chain", () => {
    expect(confirmationsForChain(999_999)).toBe(1);
    expect(confirmationsForChain(11_155_111)).toBe(1);
  });
});

describe("classifyWaitError", () => {
  it("classifies the receipt timeout", () => {
    expect(classifyWaitError(new WaitForTransactionReceiptTimeoutError({ hash: TEST_TX_HASH }))).toBe("timeout");
  });

  it("classifies a timeout from another viem copy by name", () => {
    const foreign = new Error("timed out");
    foreign.name = "WaitForTransactionReceiptTimeoutError";
    expect(classifyWaitError(foreign)).toBe("timeout");
  });

  it("classifies transport and not-found errors as transient", () => {
    expect(classifyWaitError(new HttpRequestError({ url: "https://rpc.test", details: "boom" }))).toBe("transient");
    expect(classifyWaitError(new TransactionReceiptNotFoundError({ hash: TEST_TX_HASH }))).toBe("transient");
    expect(classifyWaitError(new TypeError("Failed to fetch"))).toBe("transient");
  });

  it("classifies our own verification errors as terminal", () => {
    expect(classifyWaitError(new ReceiptVerificationError("swap", "reverted"))).toBe("terminal");
    expect(classifyWaitError(new TransactionReplacedError("approve", "cancelled"))).toBe("terminal");
  });

  it("treats a wallet rejection during the wait as transient, since the transaction was already sent", () => {
    expect(classifyWaitError(new UserRejectedRequestError(new Error("rejected")))).toBe("transient");
    const foreign = new Error("rejected");
    foreign.name = "UserRejectedRequestError";
    expect(classifyWaitError(foreign)).toBe("transient");
    expect(classifyWaitError(Object.assign(new Error("rejected"), { code: 4001 }))).toBe("transient");
  });

  it("treats a bare Error as transient", () => {
    expect(classifyWaitError(new Error("unknown"))).toBe("transient");
    expect(classifyWaitError("not even an error")).toBe("transient");
    expect(classifyWaitError(undefined)).toBe("transient");
  });
});
