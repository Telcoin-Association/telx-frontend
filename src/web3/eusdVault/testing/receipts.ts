/**
 * Receipt and pending-record builders for the vault's tests. Topics and data are ABI-encoded for real, so
 * `parseEventLogs` decodes them exactly as it decodes an RPC receipt. Test-only: nothing here belongs in app code.
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type EncodeEventTopicsReturnType,
  type Hash,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, vaultAbi } from "../abis";
import { VAULT_DEPLOYMENTS, routeFor } from "../deployments";
import type { PendingApproveRecord, PendingSwapRecord } from "../types";

/** The wallet every builder uses unless told otherwise. */
export const TEST_WALLET: Address = "0x5555555555555555555555555555555555555555";

/** The default transaction hash of records and receipts. */
export const TEST_TX_HASH: Hash = `0x${"11".repeat(32)}`;

/** The default block hash of receipts and their logs. */
export const TEST_BLOCK_HASH: Hash = `0x${"22".repeat(32)}`;

/** The default block number of receipts and their logs. */
export const TEST_BLOCK_NUMBER = 100n;

/** The default `submittedAt` (a `Date.now()` value in September 2026). */
export const TEST_NOW = 1_790_000_000_000;

/** The default amount in, 250 tokens at 6 decimals. */
export const TEST_AMOUNT_IN = 250_000_000n;

/** A log as it appears in a mined receipt. */
export type ReceiptLog = Log<bigint, number, false>;

/** Fields of a pending record a test may set; addresses follow `chainId` and `direction` unless given. */
export type PendingRecordOverrides<R> = Partial<Omit<R, "kind" | "version">>;

/** Receipt-level fields a test may set on the conveniences. */
export type ReceiptOverrides = Readonly<{
  status?: TransactionReceipt["status"];
  blockNumber?: bigint;
  transactionHash?: Hash;
  from?: Address;
  to?: Address | null;
}>;

/** Arguments of the vault's `Swap` event. */
export type SwapLogArgs = Readonly<{
  sender: Address;
  recipient: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
}>;

const MINUTE_MS = 60_000;

function pendingBase(overrides: PendingRecordOverrides<PendingSwapRecord>) {
  const chainId = overrides.chainId ?? 137;
  const direction = overrides.direction ?? "usdcToEusd";
  const deployment = VAULT_DEPLOYMENTS[chainId];
  const route = routeFor(deployment, direction);
  const smartAccount = overrides.smartAccount ?? false;
  const submittedAt = overrides.submittedAt ?? TEST_NOW;
  return {
    version: 1 as const,
    hash: overrides.hash ?? TEST_TX_HASH,
    direction,
    amountIn: overrides.amountIn ?? TEST_AMOUNT_IN,
    chainId,
    address: overrides.address ?? TEST_WALLET,
    connectorId: overrides.connectorId ?? "injected",
    smartAccount,
    submittedAt,
    // The spec's TTLs (30 minutes, 7 days); tests that care about expiry pass their own expiresAt.
    expiresAt: overrides.expiresAt ?? submittedAt + (smartAccount ? 7 * 24 * 60 : 30) * MINUTE_MS,
    vault: overrides.vault ?? deployment.vault,
    tokenIn: overrides.tokenIn ?? route.tokenIn,
    tokenOut: overrides.tokenOut ?? route.tokenOut,
  };
}

/** A valid approve record: Polygon, USDC to eUSD, `TEST_WALLET`, pinned addresses unless overridden. */
export function buildPendingApproveRecord(
  overrides: PendingRecordOverrides<PendingApproveRecord> = {}
): PendingApproveRecord {
  return { ...pendingBase(overrides), kind: "approve" };
}

/** A valid swap record like `buildPendingApproveRecord`'s, quoting `amountIn` out with no fee unless overridden. */
export function buildPendingSwapRecord(overrides: PendingRecordOverrides<PendingSwapRecord> = {}): PendingSwapRecord {
  const base = pendingBase(overrides);
  return {
    ...base,
    kind: "swap",
    quotedOut: overrides.quotedOut ?? base.amountIn,
    quotedFee: overrides.quotedFee ?? 0n,
  };
}

function receiptLog(address: Address, topics: EncodeEventTopicsReturnType, data: Hex): ReceiptLog {
  return {
    address,
    // Every indexed argument is given, so each topic is a single hash.
    topics: topics as [Hex, ...Hex[]],
    data,
    blockHash: TEST_BLOCK_HASH,
    blockNumber: TEST_BLOCK_NUMBER,
    logIndex: 0,
    transactionHash: TEST_TX_HASH,
    transactionIndex: 0,
    removed: false,
  };
}

/** An ERC-20 `Approval(owner, spender, value)` emitted by `token`. */
export function approvalLog(token: Address, owner: Address, spender: Address, value: bigint): ReceiptLog {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Approval", args: { owner, spender } });
  return receiptLog(token, topics, encodeAbiParameters([{ type: "uint256" }], [value]));
}

/** An ERC-20 `Transfer(from, to, value)` emitted by `token`. */
export function transferLog(token: Address, from: Address, to: Address, value: bigint): ReceiptLog {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } });
  return receiptLog(token, topics, encodeAbiParameters([{ type: "uint256" }], [value]));
}

/** The vault's `Swap` event emitted by `vault`. */
export function swapLog(vault: Address, args: SwapLogArgs): ReceiptLog {
  const topics = encodeEventTopics({
    abi: vaultAbi,
    eventName: "Swap",
    args: { sender: args.sender, recipient: args.recipient },
  });
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [args.tokenIn, args.tokenOut, args.amountIn, args.amountOut, args.fee]
  );
  return receiptLog(vault, topics, data);
}

/** A mined receipt holding `logs`, renumbered and stamped with the receipt's block and hash. */
export function buildReceipt(
  i: Readonly<{ logs: readonly ReceiptLog[] }> & ReceiptOverrides
): TransactionReceipt {
  const blockNumber = i.blockNumber ?? TEST_BLOCK_NUMBER;
  const transactionHash = i.transactionHash ?? TEST_TX_HASH;
  return {
    blockHash: TEST_BLOCK_HASH,
    blockNumber,
    contractAddress: null,
    cumulativeGasUsed: 21_000n,
    effectiveGasPrice: 1n,
    from: i.from ?? TEST_WALLET,
    gasUsed: 21_000n,
    logs: i.logs.map((log, logIndex) => ({ ...log, blockHash: TEST_BLOCK_HASH, blockNumber, transactionHash, logIndex })),
    logsBloom: "0x",
    status: i.status ?? "success",
    to: i.to === undefined ? VAULT_DEPLOYMENTS[137].vault : i.to,
    transactionHash,
    transactionIndex: 0,
    type: "eip1559",
  };
}

/** The receipt of `record`'s approval; `value` (default `amountIn`) is the approved amount. */
export function approveReceiptFor(
  record: PendingApproveRecord,
  overrides: ReceiptOverrides & Readonly<{ value?: bigint }> = {}
): TransactionReceipt {
  const { value = record.amountIn, ...receipt } = overrides;
  return buildReceipt({
    from: record.address,
    to: record.tokenIn,
    transactionHash: record.hash,
    ...receipt,
    logs: [approvalLog(record.tokenIn, record.address, record.vault, value)],
  });
}

/**
 * The receipt of `record`'s swap, laid out as the vault emits it: the input `Transfer`, the output `Transfer`, then
 * `Swap`. `amountOut` and `fee` default to the quote; `feeRecipient` adds a fee `Transfer` when the fee is non-zero.
 */
export function swapReceiptFor(
  record: PendingSwapRecord,
  overrides: ReceiptOverrides & Readonly<{ amountOut?: bigint; fee?: bigint; feeRecipient?: Address }> = {}
): TransactionReceipt {
  const { amountOut = record.quotedOut, fee = record.quotedFee, feeRecipient, ...receipt } = overrides;
  const logs = [
    transferLog(record.tokenIn, record.address, record.vault, record.amountIn),
    transferLog(record.tokenOut, record.vault, record.address, amountOut),
  ];
  if (feeRecipient !== undefined && fee > 0n) {
    logs.push(transferLog(record.tokenOut, record.vault, feeRecipient, fee));
  }
  logs.push(
    swapLog(record.vault, {
      sender: record.address,
      recipient: record.address,
      tokenIn: record.tokenIn,
      tokenOut: record.tokenOut,
      amountIn: record.amountIn,
      amountOut,
      fee,
    })
  );
  return buildReceipt({ from: record.address, to: record.vault, transactionHash: record.hash, ...receipt, logs });
}
