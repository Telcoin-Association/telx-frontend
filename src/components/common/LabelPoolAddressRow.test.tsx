import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelPoolAddressRow from "./LabelPoolAddressRow";

jest.mock("./HelpTip", () => function MockHelpTip({ label }: { label: string }) {
  return <span>{label}</span>;
});

const row = (fields: Record<string, unknown>) => render(<LabelPoolAddressRow contractData={fields as unknown as ProtocolsContractData} />);

describe("LabelPoolAddressRow", () => {
  it("labels a Uniswap v4 pool's identifier Pool ID, as text without an explorer link", () => {
    const id = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
    row({ poolContractAddress: id, blockchain: "polygon", protocol: "uniswap" });
    expect(screen.getByRole("heading", { name: "Pool ID" })).toBeInTheDocument();
    expect(screen.getByText("About the pool ID")).toBeInTheDocument();
    expect(screen.getByText(id)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("Pool Address")).not.toBeInTheDocument();
  });

  it("keeps Pool Address and the explorer link for a legacy pool contract", () => {
    const address = "0x9b5c71936670e9f1f36e63f03384de7e06e60d2a";
    row({ poolContractAddress: address, blockchain: "polygon", protocol: "quickswap" });
    expect(screen.getByRole("heading", { name: "Pool Address" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: address })).toHaveAttribute("href", `https://polygonscan.com/address/${address}`);
  });
});
