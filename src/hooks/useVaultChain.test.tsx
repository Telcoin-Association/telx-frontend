import { act, renderHook } from "@testing-library/react";
import { UserRejectedRequestError } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import { useVaultChain } from "./useVaultChain";

jest.mock("wagmi", () => ({ useAccount: jest.fn(), useSwitchChain: jest.fn() }));

type Account = Readonly<{ isConnected: boolean; chainId?: number }>;
type SwitchOptions = Readonly<{ onError?: (error: unknown) => void }>;

const switchChain = jest.fn<void, [Readonly<{ chainId: number }>, SwitchOptions?]>();
let account: Account;
let isPending: boolean;

beforeEach(() => {
  account = { isConnected: false };
  isPending = false;
  switchChain.mockReset();
  jest.mocked(useAccount).mockImplementation(() => account as unknown as ReturnType<typeof useAccount>);
  jest
    .mocked(useSwitchChain)
    .mockImplementation(() => ({ switchChain, isPending }) as unknown as ReturnType<typeof useSwitchChain>);
});

function failNextSwitch(error: unknown) {
  switchChain.mockImplementationOnce((_variables, options) => options?.onError?.(error));
}

describe("useVaultChain", () => {
  it("starts on Ethereum and keeps a local selection while disconnected", () => {
    const { result } = renderHook(() => useVaultChain());

    expect(result.current.selectedChainId).toBe(1);
    expect(result.current.deployment).toBe(VAULT_DEPLOYMENTS[1]);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.walletChainId).toBeUndefined();
    expect(result.current.isWrongNetwork).toBe(false);

    act(() => result.current.selectChain(137));

    expect(result.current.selectedChainId).toBe(137);
    expect(result.current.deployment).toBe(VAULT_DEPLOYMENTS[137]);
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("follows the wallet's chain across chain changes", () => {
    account = { isConnected: true, chainId: 137 };
    const { result, rerender } = renderHook(() => useVaultChain());

    expect(result.current.selectedChainId).toBe(137);
    expect(result.current.deployment).toBe(VAULT_DEPLOYMENTS[137]);
    expect(result.current.walletChainId).toBe(137);
    expect(result.current.isWrongNetwork).toBe(false);

    account = { isConnected: true, chainId: 8453 };
    rerender();
    expect(result.current.selectedChainId).toBe(8453);
    expect(result.current.deployment).toBe(VAULT_DEPLOYMENTS[8453]);

    account = { isConnected: true, chainId: 1 };
    rerender();
    expect(result.current.selectedChainId).toBe(1);
  });

  it("keeps showing the wallet's last chain after a disconnect", () => {
    account = { isConnected: true, chainId: 8453 };
    const { result, rerender } = renderHook(() => useVaultChain());

    account = { isConnected: false };
    rerender();

    expect(result.current.isConnected).toBe(false);
    expect(result.current.selectedChainId).toBe(8453);
    expect(result.current.deployment).toBe(VAULT_DEPLOYMENTS[8453]);
  });

  it("reports a wrong network and keeps the local selection", () => {
    const { result, rerender } = renderHook(() => useVaultChain());
    act(() => result.current.selectChain(137));

    account = { isConnected: true, chainId: 56 };
    rerender();

    expect(result.current.isWrongNetwork).toBe(true);
    expect(result.current.walletChainId).toBe(56);
    expect(result.current.selectedChainId).toBe(137);
    expect(result.current.deployment).toBe(VAULT_DEPLOYMENTS[137]);

    account = { isConnected: true, chainId: 137 };
    rerender();
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it("starts on Ethereum when mounted on a wrong network", () => {
    account = { isConnected: true, chainId: 56 };
    const { result } = renderHook(() => useVaultChain());

    expect(result.current.isWrongNetwork).toBe(true);
    expect(result.current.selectedChainId).toBe(1);
  });

  it("does not flag a wrong network while the wallet's chain is unknown", () => {
    account = { isConnected: false, chainId: 56 };
    const { result, rerender } = renderHook(() => useVaultChain());
    expect(result.current.isWrongNetwork).toBe(false);
    expect(result.current.walletChainId).toBeUndefined();

    account = { isConnected: true, chainId: undefined };
    rerender();
    expect(result.current.isWrongNetwork).toBe(false);
    expect(result.current.selectedChainId).toBe(1);
  });

  it("asks the wallet to switch and moves only when the wallet reports the new chain", () => {
    account = { isConnected: true, chainId: 137 };
    const { result, rerender } = renderHook(() => useVaultChain());

    act(() => result.current.selectChain(8453));

    expect(switchChain).toHaveBeenCalledTimes(1);
    expect(switchChain).toHaveBeenCalledWith({ chainId: 8453 }, expect.anything());
    expect(result.current.selectedChainId).toBe(137);

    rerender();
    expect(result.current.selectedChainId).toBe(137);

    account = { isConnected: true, chainId: 8453 };
    rerender();
    expect(result.current.selectedChainId).toBe(8453);
  });

  it("does nothing when the wallet's current chain is selected", () => {
    account = { isConnected: true, chainId: 137 };
    const { result } = renderHook(() => useVaultChain());

    act(() => result.current.selectChain(137));

    expect(switchChain).not.toHaveBeenCalled();
    expect(result.current.selectedChainId).toBe(137);
  });

  it("on a wrong network, selects the chain at once and asks the wallet to switch to it", () => {
    account = { isConnected: true, chainId: 56 };
    const { result } = renderHook(() => useVaultChain());

    act(() => result.current.selectChain(8453));
    expect(result.current.selectedChainId).toBe(8453);
    expect(switchChain).toHaveBeenLastCalledWith({ chainId: 8453 }, expect.anything());

    // The shown chain can be asked for again, since the wallet is still elsewhere.
    act(() => result.current.selectChain(8453));
    expect(switchChain).toHaveBeenCalledTimes(2);
  });

  it("never asks the wallet to switch on mount or re-render", () => {
    const { result, rerender } = renderHook(() => useVaultChain());
    act(() => result.current.selectChain(8453));

    account = { isConnected: true, chainId: 56 };
    rerender();
    rerender();
    account = { isConnected: true, chainId: 137 };
    rerender();
    account = { isConnected: false };
    rerender();

    expect(switchChain).not.toHaveBeenCalled();

    account = { isConnected: true, chainId: 56 };
    const { rerender: rerenderWrong } = renderHook(() => useVaultChain());
    rerenderWrong();
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("reports a pending switch", () => {
    account = { isConnected: true, chainId: 137 };
    isPending = true;
    const { result, rerender } = renderHook(() => useVaultChain());
    expect(result.current.isSwitching).toBe(true);

    isPending = false;
    rerender();
    expect(result.current.isSwitching).toBe(false);
  });

  it.each([
    { name: "viem's rejection", error: new UserRejectedRequestError(new Error("User rejected the request.")) },
    { name: "a nested 4001", error: { message: "wrapped", cause: { code: 4001 } } },
  ])("describes $name of a switch as a cancelled switch", ({ error }) => {
    account = { isConnected: true, chainId: 137 };
    const { result } = renderHook(() => useVaultChain());

    failNextSwitch(error);
    act(() => result.current.selectChain(8453));

    expect(result.current.switchError).toEqual({ tone: "info", message: "Network switch cancelled in your wallet." });
  });

  it("keeps a rejected switch as an info notice and clears it when a later switch succeeds", () => {
    account = { isConnected: true, chainId: 137 };
    const { result, rerender } = renderHook(() => useVaultChain());

    failNextSwitch(new UserRejectedRequestError(new Error("User rejected the request.")));
    act(() => result.current.selectChain(8453));

    expect(result.current.switchError).toEqual({ tone: "info", message: "Network switch cancelled in your wallet." });
    expect(result.current.selectedChainId).toBe(137);

    act(() => result.current.selectChain(8453));
    expect(result.current.switchError).toBeUndefined();
    account = { isConnected: true, chainId: 8453 };
    rerender();
    expect(result.current.switchError).toBeUndefined();
    expect(result.current.selectedChainId).toBe(8453);
  });

  it("describes a failed switch with nothing safe to show in switch terms", () => {
    account = { isConnected: true, chainId: 137 };
    const { result } = renderHook(() => useVaultChain());

    failNextSwitch({ code: -32603 });
    act(() => result.current.selectChain(1));

    expect(result.current.switchError).toEqual({
      tone: "error",
      message: "Your wallet did not switch networks. Try again, or switch networks in your wallet.",
    });
  });

  it("clears the switch error when the wallet's chain changes", () => {
    account = { isConnected: true, chainId: 56 };
    const { result, rerender } = renderHook(() => useVaultChain());

    failNextSwitch(new Error("Chain not configured."));
    act(() => result.current.selectChain(137));
    expect(result.current.switchError).toEqual({ tone: "error", message: "Chain not configured." });

    account = { isConnected: true, chainId: 137 };
    rerender();
    expect(result.current.switchError).toBeUndefined();
  });

  it("forgets a failed switch on clearSwitchError without switching", () => {
    account = { isConnected: true, chainId: 137 };
    const { result } = renderHook(() => useVaultChain());
    failNextSwitch(new UserRejectedRequestError(new Error("User rejected the request.")));
    act(() => result.current.selectChain(8453));
    expect(result.current.switchError).toBeDefined();

    act(() => result.current.clearSwitchError());

    expect(result.current.switchError).toBeUndefined();
    expect(result.current.selectedChainId).toBe(137);
    expect(switchChain).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed switch when the wallet's own chain is chosen, without asking the wallet", () => {
    account = { isConnected: true, chainId: 137 };
    const { result } = renderHook(() => useVaultChain());
    failNextSwitch(new UserRejectedRequestError(new Error("User rejected the request.")));
    act(() => result.current.selectChain(8453));
    expect(result.current.switchError).toBeDefined();

    act(() => result.current.selectChain(137));

    expect(result.current.switchError).toBeUndefined();
    expect(switchChain).toHaveBeenCalledTimes(1);
  });

  it("returns the same object while its inputs are unchanged", () => {
    account = { isConnected: true, chainId: 137 };
    const { result, rerender } = renderHook(() => useVaultChain());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
