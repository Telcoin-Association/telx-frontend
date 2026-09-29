/**
 * @jest-environment node
 */
import initiateTransaction, { RECEIPT_POLL_MS, RECEIPT_TIMEOUT_MS, STAKING_CHAIN, switchToStakingChain, waitForReceipt } from "./transactions";
import { generateErrorToast } from "../../components/toast/ErrorToast";
import { generateSuccessToast } from "../../components/toast/SuccessToast";
import { provider } from "../../lib/ethersProvider";

jest.mock("../../lib/ethersProvider", () => ({ provider: { send: jest.fn(), getTransactionReceipt: jest.fn() } }));
jest.mock("../../components/toast/ErrorToast", () => ({ generateErrorToast: jest.fn() }));
jest.mock("../../components/toast/PendingToast", () => ({ generatePendingToast: jest.fn() }));
jest.mock("../../components/toast/SuccessToast", () => ({ generateSuccessToast: jest.fn() }));

const details = { title: "Claim", message: "" } as any;
const callbacks = () => ({ onConfirm: jest.fn(), onTransact: jest.fn(), onFinished: jest.fn(), onError: jest.fn() });

function wallet(chainId: number, overrides: Record<string, unknown> = {}) {
  let current = chainId;
  return {
    getChainId: jest.fn(async () => current),
    switchChain: jest.fn(async ({ id }: { id: number }) => {
      current = id;
    }),
    sendTransaction: jest.fn(async () => "0xhash"),
    ...overrides,
  };
}

async function send(signer: any) {
  const cb = callbacks();
  await initiateTransaction({ to: "0x8f702676830ddCA2801A4a7cDB971CDE4DF697AE", data: "0x3d18b912" }, "0xuser", details, cb.onConfirm, cb.onTransact, cb.onFinished, cb.onError, signer);
  return cb;
}

const getReceipt = provider.getTransactionReceipt as jest.Mock;
const sendRpc = provider.send as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sendRpc.mockResolvedValue("0x6fc23ac00");
  getReceipt.mockResolvedValue({ status: 1 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("initiateTransaction", () => {
  it("targets Polygon", () => {
    expect(STAKING_CHAIN.id).toBe(137);
  });

  it("switches a wallet on another network to Polygon before sending", async () => {
    const signer = wallet(56);
    await send(signer);
    expect(signer.switchChain).toHaveBeenCalledWith({ id: 137 });
    expect(signer.switchChain.mock.invocationCallOrder[0]).toBeLessThan(signer.sendTransaction.mock.invocationCallOrder[0]);
  });

  it("does not ask to switch when the wallet is already on Polygon", async () => {
    const signer = wallet(137);
    await send(signer);
    expect(signer.switchChain).not.toHaveBeenCalled();
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("sends with the Polygon chain and a legacy gas price, never EIP-1559 fields", async () => {
    const signer = wallet(137);
    await send(signer);
    const [params] = signer.sendTransaction.mock.calls[0] as any[];
    expect(params.chain.id).toBe(137);
    expect(params.gasPrice).toBe(BigInt("0x6fc23ac00"));
    expect(params).not.toHaveProperty("maxFeePerGas");
    expect(params).not.toHaveProperty("maxPriorityFeePerGas");
    expect(params.data).toBe("0x3d18b912");
  });

  it("stops without sending when the wallet refuses to switch", async () => {
    const signer = wallet(56, { switchChain: jest.fn(async () => Promise.reject(new Error("User rejected"))) });
    const cb = await send(signer);
    expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalled();
    expect(cb.onConfirm).not.toHaveBeenCalled();
    expect(generateErrorToast).toHaveBeenCalledWith(details, "Switch your wallet to Polygon to continue.");
  });

  it("stops without sending when the wallet cannot switch networks", async () => {
    await expect(switchToStakingChain({ getChainId: async () => 1 })).rejects.toThrow("cannot switch");
  });
});

describe("initiateTransaction receipt", () => {
  it("reports success once and calls onFinished once", async () => {
    getReceipt.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 1 });
    const pending = send(wallet(137));
    await jest.advanceTimersByTimeAsync(RECEIPT_POLL_MS);
    const cb = await pending;
    expect(generateSuccessToast).toHaveBeenCalledTimes(1);
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(getReceipt).toHaveBeenCalledTimes(2);
  });

  it("reports a reverted transaction and still finishes", async () => {
    getReceipt.mockResolvedValue({ status: 0 });
    const cb = await send(wallet(137));
    expect(generateErrorToast).toHaveBeenCalledWith(details, "Transaction was reverted.", "0xhash");
    expect(generateSuccessToast).not.toHaveBeenCalled();
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
  });

  it("gives up with a clear message when no receipt arrives in time", async () => {
    getReceipt.mockResolvedValue(null);
    const pending = send(wallet(137));
    await jest.advanceTimersByTimeAsync(RECEIPT_TIMEOUT_MS + RECEIPT_POLL_MS);
    const cb = await pending;
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onFinished).not.toHaveBeenCalled();
    expect(generateErrorToast).toHaveBeenCalledWith(details, expect.stringContaining("has not confirmed"), "0xhash");
    const calls = getReceipt.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10 * RECEIPT_POLL_MS);
    expect(getReceipt).toHaveBeenCalledTimes(calls);
  });

  it("stops with an error when the gas price cannot be read, without sending", async () => {
    sendRpc.mockRejectedValue(new Error("429"));
    const signer = wallet(137);
    const cb = await send(signer);
    expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledTimes(1);
  });
});

describe("waitForReceipt", () => {
  it("never overlaps lookups, even when one is slower than the poll interval", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    getReceipt.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 3 * RECEIPT_POLL_MS));
      inFlight -= 1;
      calls += 1;
      return calls === 3 ? { status: 1 } : null;
    });
    const pending = waitForReceipt("0xhash");
    await jest.advanceTimersByTimeAsync(20 * RECEIPT_POLL_MS);
    await expect(pending).resolves.toEqual({ status: 1 });
    expect(maxInFlight).toBe(1);
  });

  it("retries after a failed lookup instead of throwing", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    getReceipt.mockRejectedValueOnce(new Error("proxy 502")).mockResolvedValueOnce({ status: 1 });
    const pending = waitForReceipt("0xhash");
    await jest.advanceTimersByTimeAsync(RECEIPT_POLL_MS);
    await expect(pending).resolves.toEqual({ status: 1 });
  });
});
