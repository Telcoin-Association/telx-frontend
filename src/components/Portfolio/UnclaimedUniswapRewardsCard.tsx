import React from "react";
import { useState } from "react";
import { useAppSelector } from "@/redux/hooks";
import {
  web3Selector,
} from "../../redux/slices/web3Slice";
import ModalRewards from "../modal/ModalRewards";
import { useWalletClient } from "wagmi";
import Button from "../common/Button";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import ChainLogo from "../common/ChainLogo";
import ContractReward from "../contract/ContractReward";
import { toast } from "react-toastify";
import { publicClientBase, publicClientPolygon } from "@/lib/publicClients";
import { CLAIM_CHAINS, errorReason, oldPoolsClaimRequest, sendClaim, type OldPoolsChain } from "@/lib/claims/claimCore";
import { runExclusive, useClaimRunning } from "@/lib/claims/claimQueue";
import { isUserRejection } from "@/lib/walletErrors";

interface CardRewardsProps {
  selectedWalletAddress: string | undefined;
  /** Claimable TEL on this chain; null when the amount could not be read. */
  uniswapRewards: number | null;
  blockchain: string;
  fetchUserUniswapRewards: any;
}

const UnclaimedUniswapRewardsCard = (props: CardRewardsProps) => {
  const { uniswapRewards, blockchain, fetchUserUniswapRewards, selectedWalletAddress } = props;
  const claimRunning = useClaimRunning();
  const { activeAction, isConfirming, isTransacting } = useAppSelector(web3Selector);
  const [confirmationIsOpen, setConfirmationIsOpen] = useState(false);
  const [currentIsTransacting, setCurrentIsTransacting] = useState(false);
  const { data: walletClient } = useWalletClient();

  const openConfirmationModal = () => {
    setConfirmationIsOpen(true);
  };

  // The old pools paid out through the Base and Polygon registries only.
  const claimChain: OldPoolsChain = blockchain === "base" ? "base" : "polygon";

  const handleClaim = async () => {
    if (!walletClient || !selectedWalletAddress) {
      toast.error("Please connect your wallet first.");
      return;
    }
    setCurrentIsTransacting(true);
    try {
      const chain = CLAIM_CHAINS[claimChain];
      // The claim is simulated before the wallet prompt, and runs as the only claim on the page.
      await runExclusive(async () => {
        await walletClient.switchChain({ id: chain.id });
        await sendClaim({
          publicClient: claimChain === "base" ? publicClientBase : publicClientPolygon,
          walletClient,
          chain,
          account: selectedWalletAddress as `0x${string}`,
          request: oldPoolsClaimRequest(claimChain),
        });
      });
      toast.success("Claim confirmed!");
      fetchUserUniswapRewards();
    } catch (error) {
      if (isUserRejection(error)) toast.info("Transaction rejected by user.");
      else toast.error(`Transaction failed: ${errorReason(error)}`);
    } finally {
      setConfirmationIsOpen(false);
      setCurrentIsTransacting(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2 justify-center rounded-xl bg-black/20 p-4 md:p-4">
      {confirmationIsOpen && (
        <ModalRewards
          activeAction={activeAction}
          isConfirming={isConfirming}
          isTransacting={isTransacting}
          onClaimClick={handleClaim}
          onClose={setConfirmationIsOpen}
          textClaim={"Claim Rewards"}
          chain={blockchain}
          unclaimed={uniswapRewards ?? 0}
          protocol={"uniswap"}
        />
      )}
      <section className="flex flex-col gap-4">
        <div className="flex gap-2 items-center">
          <ChainLogo chain={blockchain} size={25} />
          <p className="text-sm text-white">{blockchain}</p>
        </div>
        <div className="flex flex-col gap-2">
          {uniswapRewards == null ? (
            <p className="text-sm text-white">Unavailable</p>
          ) : (
            <ContractReward amount={uniswapRewards} ticker={"TEL"} includeConversion={true} flex legacy />
          )}
          <Button
            className=" w-full rounded-lg"
            external={false}
            disabled={isConfirming || isTransacting || claimRunning || !uniswapRewards}
            onClick={openConfirmationModal}
            type="primary"
            linkText={
              currentIsTransacting &&
                isTransacting &&
                activeAction === "claim" ? (
                <div className="flex items-center">
                  <LoadingAnimation size={24} className="mt-2" />
                  <span className="ml-2 whitespace-nowrap">Claiming Rewards</span>
                </div>
              ) : (
                "Claim Rewards"
              )
            }
          />
        </div>
      </section>
    </div>
  );
};

export default UnclaimedUniswapRewardsCard;
