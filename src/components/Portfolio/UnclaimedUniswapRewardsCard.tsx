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
import { BASE_POSITION_REGISTRY, ETHEREUM_POSITION_REGISTRY, POLYGON_POSITION_REGISTRY } from "@/lib/contracts";
import { toast } from "react-toastify";
import { base, mainnet, polygon } from "viem/chains";
import { positionRegistryAbi } from "@/app/api/backendHelpers/helpers";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "@/lib/publicClients";
import { UserRejectedRequestError } from "viem";

interface CardRewardsProps {
  selectedWalletAddress: string | undefined;
  uniswapRewards: any;
  blockchain: string;
  fetchUserUniswapRewards: any;
}

const UnclaimedUniswapRewardsCard = (props: CardRewardsProps) => {
  const { uniswapRewards, blockchain, fetchUserUniswapRewards } = props;
  const { activeAction, isConfirming, isTransacting } = useAppSelector(web3Selector);
  const [confirmationIsOpen, setConfirmationIsOpen] = useState(false);
  const [currentIsTransacting, setCurrentIsTransacting] = useState(false);
  const { data: walletClient } = useWalletClient();

  const openConfirmationModal = () => {
    setConfirmationIsOpen(true);
  };

  const handleClaim = async () => {
    setCurrentIsTransacting(true);

    if (!walletClient) {
      toast.error("Please connect your wallet first.");
      return;
    }

    try {
      const claimConfig = {
        ethereum: {
          chain: mainnet,
          positionRegistry: ETHEREUM_POSITION_REGISTRY,
          publicClient: publicClientEthereum,
        },
        base: {
          chain: base,
          positionRegistry: BASE_POSITION_REGISTRY,
          publicClient: publicClientBase,
        },
        polygon: {
          chain: polygon,
          positionRegistry: POLYGON_POSITION_REGISTRY,
          publicClient: publicClientPolygon,
        },
      } as const;

      const selectedClaim = claimConfig[blockchain as keyof typeof claimConfig] ?? claimConfig.polygon;
      const { chain, positionRegistry, publicClient } = selectedClaim;

      // 🔄 Request wallet to switch chain
      await walletClient.switchChain({ id: chain.id });

      // ✍️ Write contract using Viem
      const hash = await walletClient.writeContract({
        address: positionRegistry as `0x${string}`,
        abi: positionRegistryAbi,
        functionName: "claim",
        chain,
      });
      toast.success("Claim confirmed!");
      console.log("Transaction sent:", hash);

      // ⏳ Wait until the transaction is confirmed
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      console.log("Claim confirmed!", receipt);

      setConfirmationIsOpen(false);
      setCurrentIsTransacting(false);

      // 🔁 Refresh user reward data
      fetchUserUniswapRewards();
    } catch (error: any) {
      console.log("Claim error:", error);

      // 👋 User rejected the transaction
      if (error instanceof UserRejectedRequestError) {
        toast.info("Transaction rejected by user.");
        setConfirmationIsOpen(false);
        return;
      }

      // Other errors (contract revert, RPC issue, wrong params)
      toast.error(`Transaction failed: ${error?.shortMessage || error?.message || "Unknown error"}`);
      setCurrentIsTransacting(false);
      setConfirmationIsOpen(false);
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
          unclaimed={uniswapRewards}
          protocol={"uniswap"}
        />
      )}
      <section className="flex flex-col gap-4">
        <div className="flex gap-2 items-center">
          <ChainLogo chain={blockchain} size={25} />
          <p className="text-sm text-white">{blockchain}</p>
        </div>
        <div className="flex flex-col gap-2">
          <ContractReward amount={uniswapRewards} ticker={"TEL"} includeConversion={true} flex legacy />
          <Button
            className=" w-full rounded-lg"
            external={false}
            disabled={isConfirming || isTransacting || Number(uniswapRewards) === 0}
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
