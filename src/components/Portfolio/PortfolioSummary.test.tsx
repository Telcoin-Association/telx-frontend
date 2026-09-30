import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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
});
