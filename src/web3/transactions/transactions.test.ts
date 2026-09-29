/**
 * @jest-environment node
 */
import initiateTransaction, { STAKING_CHAIN, switchToStakingChain } from "./transactions";
import { generateErrorToast } from "../../components/toast/ErrorToast";

jest.mock("../../lib/ethersProvider", () => ({ provider: { send: jest.fn(async () => "0x6fc23ac00"), getTransactionReceipt: jest.fn(async () => null) } }));
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
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
