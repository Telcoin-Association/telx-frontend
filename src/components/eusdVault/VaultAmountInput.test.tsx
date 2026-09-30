import React, { useState } from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultAmountInput, type VaultAmountInputProps } from "./VaultAmountInput";

/** Holds the text like the page does, so typing sees each sanitised value. */
function Controlled({ onChange, ...props }: Omit<VaultAmountInputProps, "value">) {
  const [value, setValue] = useState("");
  return (
    <VaultAmountInput
      {...props}
      value={value}
      onChange={(text) => {
        onChange(text);
        setValue(text);
      }}
    />
  );
}

const input = () => screen.getByRole("textbox", { name: "Amount of USDC to swap" });

describe("VaultAmountInput", () => {
  it("renders a decimal text input with a placeholder and a MAX button", () => {
    render(<VaultAmountInput value="12.5" onChange={jest.fn()} onMax={jest.fn()} symbol="USDC" id="amount-in" />);
    expect(input()).toHaveValue("12.5");
    expect(input()).toHaveAttribute("type", "text");
    expect(input()).toHaveAttribute("inputMode", "decimal");
    expect(input()).toHaveAttribute("autoComplete", "off");
    expect(input()).toHaveAttribute("placeholder", "0.0");
    expect(input()).toHaveAttribute("id", "amount-in");
    expect(input()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "MAX" })).toHaveAttribute("type", "button");
  });

  it("names the input after the symbol", () => {
    render(<VaultAmountInput value="" onChange={jest.fn()} onMax={jest.fn()} symbol="eUSD" />);
    expect(screen.getByRole("textbox", { name: "Amount of eUSD to swap" })).toBeInTheDocument();
  });

  it("drops commas and letters while typing", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Controlled onChange={onChange} onMax={jest.fn()} symbol="USDC" />);
    await user.type(input(), "1,234.5a");
    expect(input()).toHaveValue("1234.5");
    expect(onChange).toHaveBeenLastCalledWith("1234.5");
    for (const [text] of onChange.mock.calls) expect(text).toMatch(/^[0-9]*\.?[0-9]*$/);
  });

  it("keeps only the first dot while typing", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Controlled onChange={onChange} onMax={jest.fn()} symbol="USDC" />);
    await user.type(input(), "1.2.3");
    expect(input()).toHaveValue("1.23");
    expect(onChange).toHaveBeenLastCalledWith("1.23");
  });

  it("sanitises pasted text", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Controlled onChange={onChange} onMax={jest.fn()} symbol="USDC" />);
    await user.click(input());
    await user.paste("1,234.5a");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("1234.5");
    expect(input()).toHaveValue("1234.5");
  });

  it("sanitises a whole replaced value", () => {
    const onChange = jest.fn();
    render(<VaultAmountInput value="" onChange={onChange} onMax={jest.fn()} symbol="USDC" />);
    fireEvent.change(input(), { target: { value: "1.2.3" } });
    expect(onChange).toHaveBeenCalledWith("1.23");
    fireEvent.change(input(), { target: { value: " 1 000,50 USDC" } });
    expect(onChange).toHaveBeenLastCalledWith("100050");
  });

  it("passes the text through without parsing or rounding it", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Controlled onChange={onChange} onMax={jest.fn()} symbol="USDC" />);
    await user.type(input(), "0.1234567");
    expect(onChange).toHaveBeenLastCalledWith("0.1234567");
    await user.clear(input());
    await user.type(input(), "007.");
    expect(onChange).toHaveBeenLastCalledWith("007.");
  });

  it("calls onMax from the MAX button", async () => {
    const user = userEvent.setup();
    const onMax = jest.fn();
    const onChange = jest.fn();
    render(<VaultAmountInput value="" onChange={onChange} onMax={onMax} symbol="USDC" />);
    await user.click(screen.getByRole("button", { name: "MAX" }));
    expect(onMax).toHaveBeenCalledTimes(1);
    expect(onMax).toHaveBeenCalledWith();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the input invalid", () => {
    render(<VaultAmountInput value="1.1234567" onChange={jest.fn()} onMax={jest.fn()} symbol="USDC" invalid />);
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input()).toHaveValue("1.1234567");
  });

  it("blocks typing and MAX while disabled", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onMax = jest.fn();
    render(<VaultAmountInput value="5" onChange={onChange} onMax={onMax} symbol="USDC" disabled />);
    expect(input()).toBeDisabled();
    expect(screen.getByRole("button", { name: "MAX" })).toBeDisabled();
    await user.type(input(), "1");
    await user.click(screen.getByRole("button", { name: "MAX" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onMax).not.toHaveBeenCalled();
    expect(input()).toHaveValue("5");
  });

  it("blocks only MAX when maxDisabled", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onMax = jest.fn();
    render(<Controlled onChange={onChange} onMax={onMax} symbol="USDC" maxDisabled />);
    expect(screen.getByRole("button", { name: "MAX" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "MAX" }));
    expect(onMax).not.toHaveBeenCalled();
    await user.type(input(), "2");
    expect(onChange).toHaveBeenCalledWith("2");
  });
});
