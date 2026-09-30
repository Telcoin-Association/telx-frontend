/** @jest-environment node */
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  UserRejectedRequestError,
  createClient,
  custom,
  encodeErrorResult,
  type Address,
  type Hex,
} from "viem";
import { vaultAbi } from "./abis";
import { VAULT_DEPLOYMENTS } from "./deployments";
import { AppError, VaultStateChangedError } from "./errors";
import { createClientChainSource } from "./reads";
import type { StateChange } from "./types";
import { decodeVaultRevert } from "./vaultErrors";

const d = VAULT_DEPLOYMENTS[137];
const WALLET: Address = "0x1111111111111111111111111111111111111111";

const BLACKLISTED = "This wallet cannot send or receive eUSD.";
const TRANSFER_FAILED = "The token transfer failed. Check your balance and approval, then try again.";

const ZERO_AMOUNT = encodeErrorResult({ abi: vaultAbi, errorName: "ZeroAmount" });

const errorStringAbi = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const;

function errorString(message: string): Hex {
  return encodeErrorResult({ abi: errorStringAbi, errorName: "Error", args: [message] });
}

/** An EIP-1193 provider error, as a node returns it for a reverted `eth_call`. */
function executionReverted(data: Hex) {
  return Object.assign(new Error("execution reverted"), { code: 3, data });
}

/** Runs the real `simulateSwap` against a provider that rejects `eth_call` with `rejection`; returns viem's error. */
async function simulatedError(rejection: unknown, functionName: "sellGem" | "buyGem" = "sellGem"): Promise<unknown> {
  const client = createClient({
    transport: custom(
      {
        async request({ method }: { method: string }) {
          if (method === "eth_call") throw rejection;
          throw new Error(`unexpected ${method}`);
        },
      },
      { retryCount: 0 }
    ),
  });
  const source = createClientChainSource(client);
  return source
    .simulateSwap({ vault: d.vault, functionName, account: WALLET, recipient: WALLET, amountIn: 1_000000n })
    .then(
      () => {
        throw new Error("the simulation did not revert");
      },
      (error: unknown) => error
    );
}

function expectStateChange(result: unknown, change: StateChange) {
  expect(result).toBeInstanceOf(VaultStateChangedError);
  const error = result as VaultStateChangedError;
  expect(error.change).toBe(change);
  expect(error.retryable).toBe(false);
  expect(error.message).toBe(new VaultStateChangedError(change).message);
}

describe("decodeVaultRevert", () => {
  it("receives viem's ContractFunctionRevertedError from a reverted simulation", async () => {
    const error = await simulatedError(executionReverted(ZERO_AMOUNT));
    expect(error).toBeInstanceOf(ContractFunctionExecutionError);
    expect((error as BaseError).walk((e) => e instanceof ContractFunctionRevertedError)).toBeTruthy();
  });

  it.each([
    ["EnforcedPause", "paused", encodeErrorResult({ abi: vaultAbi, errorName: "EnforcedPause" })],
    ["InsufficientReserves", "reserves", encodeErrorResult({ abi: vaultAbi, errorName: "InsufficientReserves" })],
    [
      "ExceedsTransactionLimit",
      "per-transaction",
      encodeErrorResult({ abi: vaultAbi, errorName: "ExceedsTransactionLimit" }),
    ],
    ["ExceedsBlockLimit", "per-block", encodeErrorResult({ abi: vaultAbi, errorName: "ExceedsBlockLimit" })],
    ["ZeroAmount", "zero-output", encodeErrorResult({ abi: vaultAbi, errorName: "ZeroAmount" })],
    [
      "ERC20InsufficientAllowance",
      "allowance",
      encodeErrorResult({ abi: vaultAbi, errorName: "ERC20InsufficientAllowance", args: [d.vault, 1n, 2n] }),
    ],
    [
      "ERC20InsufficientBalance",
      "balance",
      encodeErrorResult({ abi: vaultAbi, errorName: "ERC20InsufficientBalance", args: [WALLET, 1n, 2n] }),
    ],
  ] as const)("maps %s to %s", async (_, change, data) => {
    expectStateChange(decodeVaultRevert(await simulatedError(executionReverted(data))), change);
    expectStateChange(decodeVaultRevert(await simulatedError(executionReverted(data), "buyGem")), change);
  });

  it("maps eUSD's Blacklisted to the blacklist message", async () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "Blacklisted", args: [WALLET] });
    const result = decodeVaultRevert(await simulatedError(executionReverted(data)));
    expect(result).toBeInstanceOf(AppError);
    expect(result).not.toBeInstanceOf(VaultStateChangedError);
    expect(result?.message).toBe(BLACKLISTED);
  });

  it("maps SafeERC20FailedOperation to the transfer-failed message, not to an allowance change", async () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "SafeERC20FailedOperation", args: [d.gem] });
    const result = decodeVaultRevert(await simulatedError(executionReverted(data)));
    expect(result).toBeInstanceOf(AppError);
    expect(result).not.toBeInstanceOf(VaultStateChangedError);
    expect(result?.message).toBe(TRANSFER_FAILED);
  });

  it.each([
    ["ERC20: transfer amount exceeds allowance", "allowance"],
    ["ERC20: transfer amount exceeds balance", "balance"],
    ["Pausable: paused", "paused"],
    ["PAUSABLE: PAUSED", "paused"],
  ] as const)("maps USDC's %j to %s", async (reason, change) => {
    expectStateChange(decodeVaultRevert(await simulatedError(executionReverted(errorString(reason)))), change);
  });

  it("maps USDC's blacklist reason to the blacklist message", async () => {
    const error = await simulatedError(executionReverted(errorString("Blacklistable: account is blacklisted")));
    const result = decodeVaultRevert(error);
    expect(result).toBeInstanceOf(AppError);
    expect(result).not.toBeInstanceOf(VaultStateChangedError);
    expect(result?.message).toBe(BLACKLISTED);
  });

  it("returns undefined for another Error(string) reason", async () => {
    expect(decodeVaultRevert(await simulatedError(executionReverted(errorString("Something else"))))).toBeUndefined();
  });

  it("finds the data a wallet nests under data.data", async () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "InsufficientReserves" });
    const rpcError = { code: -32603, message: "Internal JSON-RPC error.", data: { code: 3, data } };
    expectStateChange(decodeVaultRevert(await simulatedError(rpcError)), "reserves");
    expectStateChange(decodeVaultRevert(rpcError), "reserves");
  });

  it("finds raw data nested under cause", () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "ExceedsBlockLimit" });
    const walletError = new Error("Transaction simulation failed", {
      cause: new Error("wrapped", { cause: { code: 3, message: "execution reverted", data } }),
    });
    expectStateChange(decodeVaultRevert(walletError), "per-block");
  });

  it("finds raw data directly on an RPC error object", () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "EnforcedPause" });
    expectStateChange(decodeVaultRevert(executionReverted(data)), "paused");
  });

  it("decodes revert data the thrower's ABI did not know", () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "InsufficientReserves" });
    const error = new ContractFunctionRevertedError({ abi: [], data, functionName: "sellGem" });
    expectStateChange(decodeVaultRevert(error), "reserves");
  });

  it("keeps the original error as the cause", async () => {
    const error = await simulatedError(executionReverted(ZERO_AMOUNT));
    expect(decodeVaultRevert(error)?.cause).toBe(error);
  });

  it("returns undefined for an unknown selector", async () => {
    const unknown: Hex = `0xdeadbeef${"00".repeat(32)}`;
    expect(decodeVaultRevert(await simulatedError(executionReverted(unknown)))).toBeUndefined();
    expect(decodeVaultRevert(executionReverted(unknown))).toBeUndefined();
  });

  it("returns undefined for a vault error that is not a state change", async () => {
    const data = encodeErrorResult({ abi: vaultAbi, errorName: "ZeroAddress" });
    expect(decodeVaultRevert(await simulatedError(executionReverted(data)))).toBeUndefined();
  });

  it("returns undefined for an HTTP failure", async () => {
    const http = new HttpRequestError({ url: "https://rpc.example", status: 502, body: { method: "eth_call" } });
    expect(decodeVaultRevert(await simulatedError(http))).toBeUndefined();
    expect(decodeVaultRevert(http)).toBeUndefined();
  });

  it("returns undefined for a user rejection", async () => {
    const rejection = { code: 4001, message: "User rejected the request." };
    const error = await simulatedError(rejection);
    expect((error as BaseError).walk((e) => e instanceof UserRejectedRequestError)).toBeTruthy();
    expect(decodeVaultRevert(error)).toBeUndefined();
  });

  it.each([undefined, null, "execution reverted", 3, { data: "not hex" }, { data: "0x08c3" }])(
    "returns undefined for %p",
    (value) => {
      expect(decodeVaultRevert(value)).toBeUndefined();
    }
  );

  it("stops on a cause cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });
    expect(decodeVaultRevert(a)).toBeUndefined();
  });

  it("gives up past a bounded depth", () => {
    let error: unknown = executionReverted(encodeErrorResult({ abi: vaultAbi, errorName: "EnforcedPause" }));
    for (let i = 0; i < 50; i += 1) error = new Error(`layer ${i}`, { cause: error });
    expect(decodeVaultRevert(error)).toBeUndefined();
  });

  it("returns undefined when reading the error throws", () => {
    const hostile = {
      get cause(): unknown {
        throw new Error("getter");
      },
    };
    expect(decodeVaultRevert(hostile)).toBeUndefined();
  });
});
