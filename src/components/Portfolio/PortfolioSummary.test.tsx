import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortfolioSummary, { type PortfolioSummaryProps } from "./PortfolioSummary";
jest.mock("../common/AddTokenToWallet", () => function MockAddTokenToWallet({ token }: { token: { symbol: string } }) {
  return <span data-testid="add-token-to-wallet">{`add ${token.symbol}`}</span>;
});

const base: PortfolioSummaryProps = {
  positionsValueUsd: 6020,
  positionsPartialNote: null,
  positionsLoading: false,
  claimableTel: 1500,
  legacyClaimableTel: null,
  claimablePartialNote: null,
  claimableLoading: false,
  pendingTel: 25,
  telUsd: 0.005,
  openPositions: 3,
  subscribedPositions: 2,
};

const renderSummary = (props: Partial<PortfolioSummaryProps> = {}) => render(<PortfolioSummary {...base} {...props} />);

describe("PortfolioSummary", () => {
  it("shows position value, claimable and pending TEL with their USD value, and subscribed positions", () => {
    renderSummary();
    expect(screen.getByText("$6,020.00")).toBeInTheDocument();
    expect(screen.getByText("1,500 TEL")).toBeInTheDocument();
    expect(screen.getByText("$7.50")).toBeInTheDocument();
    expect(screen.getByText("25 TEL")).toBeInTheDocument();
    expect(screen.getByText("Claimable once Merkl publishes its next rewards update.")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Subscribe a position to earn TELx rewards on it.")).toBeInTheDocument();
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-token-to-wallet")).toHaveTextContent("add TEL");
  });

  it("marks a total partial and explains what it leaves out", () => {
    renderSummary({ positionsPartialNote: "Excludes positions on Base, which could not be loaded.", claimablePartialNote: "Excludes Merkl rewards on Polygon." });
    const markers = screen.getAllByText("partial");
    expect(markers).toHaveLength(2);
    expect(screen.getByText("Excludes positions on Base, which could not be loaded.")).toBeInTheDocument();
  });

  it("lists legacy TEL from old pools separately, without a USD value", () => {
    renderSummary({ claimableTel: 0, legacyClaimableTel: 40 });
    expect(screen.getByText("Plus 40 legacy TEL from old pools.")).toBeInTheDocument();
    expect(screen.getByText("Claim each amount below.")).toBeInTheDocument();
  });

  it("reads Unavailable for totals it could not read, never zero", () => {
    renderSummary({ positionsValueUsd: null, claimableTel: null, pendingTel: null });
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.queryByText("0 TEL")).not.toBeInTheDocument();
  });

  it("shows spinners and no footnotes while loading", () => {
    renderSummary({ positionsLoading: true, claimableLoading: true });
    expect(screen.queryByText("$6,020.00")).not.toBeInTheDocument();
    expect(screen.queryByText("Claim each amount below.")).not.toBeInTheDocument();
    expect(screen.queryByText("2 of 3")).not.toBeInTheDocument();
  });

  it("offers the claim button on the Claimable TEL tile, pointing to the cards for single claims", async () => {
    const onClick = jest.fn();
    renderSummary({ claimAction: { label: "Claim all (2 chains)", disabledReason: null, onClick } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Claim all (2 chains)" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByText("Or claim each amount in its own card below.")).toBeInTheDocument();
  });

  it("disables the claim button with its reason when there is nothing to claim", () => {
    renderSummary({ claimableTel: 0, legacyClaimableTel: null, claimAction: { label: "Claim TEL", disabledReason: "Nothing to claim yet.", onClick: jest.fn() } });
    const button = screen.getByRole("button", { name: "Claim TEL" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Nothing to claim yet.");
  });

  it("hides the claim button while the amounts load", () => {
    renderSummary({ claimableLoading: true, claimAction: { label: "Claim TEL", disabledReason: null, onClick: jest.fn() } });
    expect(screen.queryByRole("button", { name: "Claim TEL" })).not.toBeInTheDocument();
  });
});
