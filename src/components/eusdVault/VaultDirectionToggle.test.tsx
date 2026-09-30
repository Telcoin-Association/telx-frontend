import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultDirectionToggle } from "./VaultDirectionToggle";

describe("VaultDirectionToggle", () => {
  it("names the current direction", () => {
    const { rerender } = render(<VaultDirectionToggle direction="usdcToEusd" onChange={jest.fn()} />);
    const button = screen.getByRole("button", { name: "Reverse direction, now USDC to eUSD" });
    expect(button).toHaveAttribute("type", "button");
    rerender(<VaultDirectionToggle direction="eusdToUsdc" onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Reverse direction, now eUSD to USDC" })).toBeInTheDocument();
  });

  it("flips USDC to eUSD into eUSD to USDC", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<VaultDirectionToggle direction="usdcToEusd" onChange={onChange} />);
    await user.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("eusdToUsdc");
  });

  it("flips eUSD to USDC into USDC to eUSD", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<VaultDirectionToggle direction="eusdToUsdc" onChange={onChange} />);
    await user.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("usdcToEusd");
  });

  it("flips from the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<VaultDirectionToggle direction="usdcToEusd" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("eusdToUsdc");
  });

  it("is disabled and blocks onChange while disabled", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<VaultDirectionToggle direction="usdcToEusd" onChange={onChange} disabled />);
    const button = screen.getByRole("button", { name: "Reverse direction, now USDC to eUSD" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onChange).not.toHaveBeenCalled();
  });
});
