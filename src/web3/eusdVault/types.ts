/**
 * The eUSD vault's shared types (spec Appendix A). Types only: no runtime code, no React or wagmi. Functions,
 * constants and classes live in the modules named by each section comment; error classes live in `errors.ts`.
 */
import type { Address, Hash, Hex, TransactionReceipt } from "viem";
import type { AmountInput } from "./amount";
import type { SwapDirection, VaultChainId, VaultOperation } from "./deployments";

export type { VaultChainId, SwapDirection, VaultOperation, VaultDeployment, SwapRoute } from "./deployments";
export type { AmountInput } from "./amount";

// errors

export type ErrorTone = "info" | "warning" | "error";

export type ErrorDescription = Readonly<{ tone: ErrorTone; message: string }>;

// shared: requests, pending records, live state

export type SwapQuote = Readonly<{ amountOut: bigint; fee: bigint }>;

export type ApproveRequest = Readonly<{ kind: "approve"; direction: SwapDirection; amountIn: bigint }>;

export type SwapRequest = Readonly<{ kind: "swap"; direction: SwapDirection; amountIn: bigint; quote: SwapQuote }>;

export type VaultRequest = ApproveRequest | SwapRequest;

type PendingBase = Readonly<{
  version: 1;
  hash: Hash;
  direction: SwapDirection;
  amountIn: bigint;
  chainId: VaultChainId;
  address: Address;
  connectorId: string;
  smartAccount: boolean;
  /** `Date.now()` when the wallet returned the hash. */
  submittedAt: number;
  expiresAt: number;
  vault: Address;
  tokenIn: Address;
  tokenOut: Address;
}>;

export type PendingApproveRecord = PendingBase & Readonly<{ kind: "approve" }>;

export type PendingSwapRecord = PendingBase & Readonly<{ kind: "swap"; quotedOut: bigint; quotedFee: bigint }>;

export type VaultPendingRecord = PendingApproveRecord | PendingSwapRecord;

export type PendingContext = Readonly<{ chainId: number; address: Address; connectorId: string }>;

/** `updatedAt` is `Date.now()` when the allowance was read, comparable with `submittedAt`. */
export type LiveAllowance = Readonly<{ value?: bigint; updatedAt?: number }>;

export type VaultLiveState = Readonly<{ allowances: Readonly<Partial<Record<SwapDirection, LiveAllowance>>> }>;

export type SwapResult = Readonly<{ amountIn: bigint; amountOut: bigint; fee: bigint }>;

// pendingRecords

export type PendingStorage = Readonly<{
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
  subscribe(k: string, l: () => void): () => void;
}>;

// reads

export type Multicall3Call = Readonly<{ target: Address; allowFailure: boolean; callData: Hex }>;

export type Multicall3Result = Readonly<{ success: boolean; returnData: Hex }>;

export type VaultSnapshot = Readonly<{
  chainId: number;
  blockNumber: bigint;
  stable: Address;
  gem: Address;
  vaultPaused: boolean;
  stablePaused: boolean;
  stableReserve: bigint;
  gemReserve: bigint;
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  /** Absent when the preview sub-call failed. */
  quote?: SwapQuote;
  balanceIn: bigint;
  allowanceIn: bigint;
}>;

export type VaultPageState = Readonly<{
  chainId: number;
  blockNumber: bigint;
  stable: Address;
  gem: Address;
  vaultPaused: boolean;
  stablePaused: boolean;
  stableReserve: bigint;
  gemReserve: bigint;
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  tin: bigint;
  tout: bigint;
  quote?: SwapQuote;
  balances?: Readonly<{ stable: bigint; gem: bigint }>;
  allowances?: Readonly<{ stable: bigint; gem: bigint }>;
}>;

// preflight

export type SimulateSwapParams = Readonly<{
  vault: Address;
  functionName: "sellGem" | "buyGem";
  account: Address;
  recipient: Address;
  amountIn: bigint;
}>;

export type ChainSource = Readonly<{
  /** Uncached (`cacheTime: 0`). */
  getBlockNumber(): Promise<bigint>;
  aggregate3(
    multicall3: Address,
    calls: readonly Multicall3Call[],
    blockNumber?: bigint
  ): Promise<readonly Multicall3Result[]>;
  /** `eth_call` of the swap at the latest block; resolves with `amountOut`. */
  simulateSwap(p: SimulateSwapParams): Promise<bigint>;
  getCode(address: Address): Promise<Hex | undefined>;
}>;

export type StateChange =
  | "balance"
  | "allowance"
  | "quote"
  | "zero-output"
  | "per-transaction"
  | "per-block"
  | "reserves"
  | "paused";

// receiptVerification

/** viem's replacement reasons. Only `repriced` keeps the original call. */
export type ReplacementReason = "repriced" | "cancelled" | "replaced";

export type ReceiptVerificationReason = "reverted" | "missing-event" | "post-state" | "unverifiable";

export type ReceiptVerificationResult = Readonly<{ kind: "approve" }> | Readonly<{ kind: "swap"; swap: SwapResult }>;

// receiptWatcher

export type WaitForReceiptParams = Readonly<{
  hash: Hash;
  confirmations: number;
  pollingInterval: number;
  timeout: number;
  checkReplacement: boolean;
  onReplaced: (replacement: Readonly<{ reason: ReplacementReason }>) => void;
}>;

/** `wallet_getCallsStatus` for a smart account's transaction hash (the portal's `SafeCallsStatus`). */
export type SmartAccountCallsStatus = Readonly<{
  status: "pending" | "success" | "failure" | undefined;
  statusCode: number;
}>;

export type WatchPhase = "waiting" | "verifying";

export type WatchProgress = Readonly<{
  /** Number of waits that ended in a timeout or a transient error so far. */
  attempt: number;
  phase: WatchPhase;
  lastError?: unknown;
}>;

export type ReceiptWatcherDeps = Readonly<{
  waitForReceipt(p: WaitForReceiptParams): Promise<TransactionReceipt>;
  /** The wallet's allowance for the vault at the receipt's block. Approve post-state only. */
  readAllowanceAt(blockNumber: bigint): Promise<bigint>;
  /** Only a smart account reports a cancelled or failed queue entry; there is no on-chain signal for it. */
  getCallsStatus?: (hash: Hash) => Promise<SmartAccountCallsStatus>;
  now(): number;
  /** Must resolve early when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  onProgress?(p: WatchProgress): void;
}>;

export type WatchOutcome =
  | Readonly<{
      type: "confirmed";
      receipt: TransactionReceipt;
      /** Amounts from the vault's `Swap` event. Set for a swap only. */
      swap?: SwapResult;
      /** Set when the wallet sped the transaction up; the call was unchanged. */
      replacementReason?: "repriced";
    }>
  | Readonly<{ type: "failed"; reason: "reverted" | "cancelled" | "replaced" | "verification"; error: Error }>
  /** The record's TTL passed without a terminal receipt. The record is kept. */
  | Readonly<{ type: "expired" }>
  /** The caller aborted; nothing about the transaction is known. */
  | Readonly<{ type: "aborted" }>;

// lifecycleStore

export type VaultLifecycleStatus = "idle" | "preflight" | "signing" | "confirming" | "verifying" | "confirmed" | "failed";

export type VaultFailureReason =
  | "rejected"
  | "preflight"
  | "providers-disagree"
  | "state-changed"
  | "reverted"
  | "cancelled"
  | "replaced"
  | "verification"
  | "unknown";

export type LifecycleFailure = Readonly<{ reason: VaultFailureReason; error: Error }>;

export type PendingSummary = Readonly<{
  kind: VaultOperation;
  direction: SwapDirection;
  hash: Hash;
  amountIn: bigint;
  quotedOut?: bigint;
  quotedFee?: bigint;
  chainId: number;
  submittedAt: number;
  expiresAt: number;
  expired: boolean;
  smartAccount: boolean;
  attempt: number;
}>;

export type CompletedSwap = Readonly<{
  direction: SwapDirection;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  quotedOut: bigint;
  /** The hash the wallet returned (the record's key). */
  hash: Hash;
  /** The mined transaction's hash, from the receipt. */
  transactionHash: Hash;
  chainId: VaultChainId;
}>;

export type SettledApproval = Readonly<{ kind: "approve"; direction: SwapDirection; hash: Hash }>;

export type VaultLifecycleState = Readonly<{
  status: VaultLifecycleStatus;
  kind?: VaultOperation;
  direction?: SwapDirection;
  hash?: Hash;
  amountIn?: bigint;
  confirmedBlock?: bigint;
  smartAccount: boolean;
  pending?: PendingSummary;
  failure?: LifecycleFailure;
  completed?: CompletedSwap;
  settledExternally?: SettledApproval;
  canSubmit: boolean;
}>;

/**
 * An open wallet connection. Whether the account is a smart account is not carried here: the store decides with
 * `isSmartAccount(connectorId, await source.getCode(address))` from `pendingRecords.ts`.
 */
export type WalletSession = Readonly<{
  address: Address;
  chainId: VaultChainId;
  connectorId: string;
  source: ChainSource;
  sendApprove(token: Address, spender: Address, amount: bigint): Promise<Hash>;
  sendSwap(vault: Address, fn: "sellGem" | "buyGem", recipient: Address, amountIn: bigint): Promise<Hash>;
  watcherDeps(r: VaultPendingRecord): Pick<ReceiptWatcherDeps, "waitForReceipt" | "readAllowanceAt" | "getCallsStatus">;
}>;

export type VaultLifecycleDeps = Readonly<{
  storage: PendingStorage;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Rejects with an AppError when the wallet is disconnected or on an unsupported chain. */
  openSession(): Promise<WalletSession>;
  resumeSession(r: VaultPendingRecord, connector: unknown): Promise<WalletSession>;
  appSource(chainId: VaultChainId): ChainSource | undefined;
  logger?: Pick<Console, "warn" | "error">;
}>;

export type WalletInput = Readonly<{ walletKey: string; context?: PendingContext; connector?: unknown }>;

export type VaultLifecycleStore = Readonly<{
  subscribe(l: () => void): () => void;
  getSnapshot(): VaultLifecycleState;
  getServerSnapshot(): VaultLifecycleState;
  setWallet(i: WalletInput): void;
  setLive(l: VaultLiveState): void;
  submit(r: VaultRequest): Promise<void>;
  acknowledge(): void;
  dismissPending(): void;
  done(): void;
  dispose(): void;
}>;

// hooks

export type VaultLifecycle = Readonly<{
  state: VaultLifecycleState;
  approve(r: Omit<ApproveRequest, "kind">): Promise<void>;
  swap(r: Omit<SwapRequest, "kind">): Promise<void>;
  acknowledge(): void;
  dismissPending(): void;
  done(): void;
}>;

export type SettleStatus = "idle" | "polling" | "settled" | "timed-out";

/** `blockNumber` is the block of the page read that produced `allowanceIn`. */
export type SettleObservation = Readonly<{ allowanceIn?: bigint; blockNumber?: bigint }>;

// view

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error?: ErrorDescription }
  | { status: "ready"; direction: SwapDirection; amountIn: bigint; quote: SwapQuote };

export type VaultViewInput = Readonly<{
  address?: Address;
  isWrongNetwork: boolean;
  hasDeployment: boolean;
  isVerifying: boolean;
  isSecurityCheckUnavailable: boolean;
  isContractVerified: boolean;
  paused: boolean;
  direction: SwapDirection;
  amount: AmountInput;
  balanceIn: bigint;
  allowanceIn: bigint;
  outputReserve: bigint;
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  quote: QuoteState;
  lifecycle: VaultLifecycleState;
  settle: SettleStatus;
  chainName?: string;
  explorerUrl?: string;
  /** The vault read's failure. */
  error?: ErrorDescription;
  /** The last network switch the wallet refused or failed. */
  switchError?: ErrorDescription;
}>;

export type PrimaryKind =
  | "connect"
  | "switch-network"
  | "verifying"
  | "unavailable"
  | "paused"
  | "busy"
  | "success"
  | "no-balance"
  | "enter-amount"
  | "invalid-amount"
  | "insufficient-balance"
  | "over-limit"
  | "quote-loading"
  | "quote-unavailable"
  | "amount-too-small"
  | "insufficient-reserves"
  | "approve"
  | "swap";

export type VaultView = Readonly<{
  primary: Readonly<{
    kind: PrimaryKind;
    label: string;
    disabled: boolean;
    action?: "connect" | "switch-network" | "approve" | "swap";
  }>;
  showStepOneComplete: boolean;
  success?: Readonly<{
    amountOutLabel: string;
    symbolOut: string;
    feeLabel?: string;
    quotedOutLabel?: string;
    chainName: string;
    href?: string;
  }>;
  secondary: ReadonlyArray<Readonly<{ kind: "dismiss" | "refresh" | "done" | "explorer"; label: string; href?: string }>>;
  notice?: Readonly<{
    tone: "info" | "warning" | "error" | "success";
    message: string;
    href?: string;
    hrefLabel?: string;
  }>;
  lockForm: boolean;
  /** While the form is locked, the pending record's direction and amount. */
  formOverride?: Readonly<{ direction: SwapDirection; amountIn: bigint }>;
}>;
