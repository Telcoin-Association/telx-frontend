import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { toast } from "react-toastify";
import { notifyVaultApprovalConfirmed, notifyVaultError, notifyVaultSwapConfirmed } from "./vaultToasts";

jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const mockToast = jest.mocked(toast);

type ToastMethod = "success" | "error" | "info" | "warning";

/** Checks that `method` was the only toast call, renders its content and returns the call's arguments. */
function showOnlyToast(method: ToastMethod) {
  for (const name of ["success", "error", "info", "warning"] as const) {
    expect(mockToast[name]).toHaveBeenCalledTimes(name === method ? 1 : 0);
  }
  const [content, options] = mockToast[method].mock.calls[0];
  const element = content as React.ReactElement<{ status?: string }>;
  render(element);
  return { status: element.props.status, options };
}

describe("vaultToasts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("announces a confirmed approval for the token", () => {
    notifyVaultApprovalConfirmed({ symbol: "USDC" });
    const { options } = showOnlyToast("success");
    expect(options).toEqual(expect.objectContaining({ toastId: "vault-approval-confirmed", autoClose: 10000 }));
    expect(screen.getByText("Approval Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Your USDC approval for the vault is confirmed. You can now swap.")).toBeInTheDocument();
  });

  it("announces a confirmed swap with its output and a link to the transaction", () => {
    notifyVaultSwapConfirmed({ amountOutLabel: "99.95", symbolOut: "eUSD", href: "https://polygonscan.com/tx/0xabc" });
    const { options } = showOnlyToast("success");
    expect(options).toEqual(expect.objectContaining({ toastId: "vault-swap-confirmed" }));
    expect(screen.getByText("Swap Confirmed")).toBeInTheDocument();
    expect(screen.getByText("You received 99.95 eUSD.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View transaction" });
    expect(link).toHaveAttribute("href", "https://polygonscan.com/tx/0xabc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("announces a confirmed swap without a link when there is no href", () => {
    notifyVaultSwapConfirmed({ amountOutLabel: "1,000", symbolOut: "USDC" });
    showOnlyToast("success");
    expect(screen.getByText("You received 1,000 USDC.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a rejection in the neutral toast, not the error one", () => {
    notifyVaultError({ tone: "info", message: "Wallet request cancelled. No transaction was sent." });
    const { status, options } = showOnlyToast("info");
    expect(status).toBe("pending");
    expect(options).toEqual(expect.objectContaining({ toastId: "vault-cancelled", autoClose: 6000 }));
    expect(screen.getByText("Transaction Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Wallet request cancelled. No transaction was sent.")).toBeInTheDocument();
  });

  it("shows a warning in the warning toast", () => {
    notifyVaultError({ tone: "warning", message: "Your balance changed. Review the amount and try again." });
    const { status, options } = showOnlyToast("warning");
    expect(status).toBe("pending");
    expect(options).toEqual(expect.objectContaining({ toastId: "vault-warning" }));
    expect(screen.getByText("Transaction Not Completed")).toBeInTheDocument();
    expect(screen.getByText("Your balance changed. Review the amount and try again.")).toBeInTheDocument();
  });

  it("shows an error in the error toast", () => {
    notifyVaultError({ tone: "error", message: "The transaction could not be completed." });
    const { status, options } = showOnlyToast("error");
    expect(status).toBe("error");
    expect(options).toEqual(expect.objectContaining({ toastId: "vault-error" }));
    expect(screen.getByText("Transaction Failed")).toBeInTheDocument();
    expect(screen.getByText("The transaction could not be completed.")).toBeInTheDocument();
  });
});
