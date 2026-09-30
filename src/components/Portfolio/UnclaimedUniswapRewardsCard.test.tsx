import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import UnclaimedUniswapRewardsCard from "./UnclaimedUniswapRewardsCard";

jest.mock("../../redux/hooks", () => ({
  useAppSelector: () => ({ activeAction: null, isConfirming: false, isTransacting: false }),
}));
jest.mock("wagmi", () => ({ useWalletClient: () => ({ data: undefined }) }));
jest.mock("viem/chains", () => ({ base: { id: 8453 }, mainnet: { id: 1 }, polygon: { id: 137 } }));
jest.mock("viem", () => ({ UserRejectedRequestError: class extends Error {} }));
jest.mock("../../lib/publicClients", () => ({ publicClientBase: {}, publicClientEthereum: {}, publicClientPolygon: {} }));
jest.mock("../../app/api/backendHelpers/helpers", () => ({ positionRegistryAbi: [] }));
jest.mock("../modal/ModalRewards", () => function ModalRewards() {
  return null;
});
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../contract/ContractReward", () => function ContractReward({ amount }: { amount: number }) {
  return <span>{`${amount} legacy TEL`}</span>;
});
jest.mock("../common/ChainLogo", () => function ChainLogo() {
  return null;
});

const renderCard = (uniswapRewards: number | null) =>
  render(
    <UnclaimedUniswapRewardsCard uniswapRewards={uniswapRewards} selectedWalletAddress="0xabc" blockchain="polygon" fetchUserUniswapRewards={jest.fn()} />
  );

describe("UnclaimedUniswapRewardsCard", () => {
  it("shows Unavailable and disables Claim when the amount could not be read", () => {
    renderCard(null);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim Rewards" })).toBeDisabled();
  });

  it("disables Claim when there is nothing to claim", () => {
    renderCard(0);
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim Rewards" })).toBeDisabled();
  });

  it("enables Claim for a positive amount", () => {
    renderCard(12.5);
    expect(screen.getByText("12.5 legacy TEL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim Rewards" })).toBeEnabled();
  });
});
