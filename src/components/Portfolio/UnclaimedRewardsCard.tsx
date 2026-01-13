import React from "react";
import { useMemo, useState } from "react";
import BigNumber from "bignumber.js";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  web3Selector,
  setActiveAction,
  setIsConfirming,
  setIsTransacting,
} from "../../redux/slices/web3Slice";
import ModalRewards from "../modal/ModalRewards";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { fetchAllContractData } from "../../redux/slices/contractsSlice";
import initiateTransaction, { getRewardData } from "../../web3/transactions/transactions";
import { useAccount, useWalletClient } from "wagmi";
import Button from "../common/Button";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import { alchemySdk } from "@/lib/alchemySdk";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import ChainLogo from "../common/ChainLogo";
import CardRewardsUnclaimed from "./CardRewardsUnclaimed";

interface CardRewardsProps {
  contractData: ProtocolsContractData;
  selectedWalletAddress: string | undefined;
  defaultRewards: any;
}

const CardRewards = (props: CardRewardsProps) => {
  const { contractData, defaultRewards } = props;
  const { activeAction, isConfirming, isTransacting } =
    useAppSelector(web3Selector);
  const dispatch = useAppDispatch();
  const [confirmationIsOpen, setConfirmationIsOpen] = useState(false);
  const [currentIsTransacting, setCurrentIsTransacting] = useState(false);
  const { address: account } = useAccount();
  const { data: walletClient } = useWalletClient();

  const {
    assets,
    rewards,
    rewardsInterval,
    protocol,
    stakeContractAddress,
    user,
  } = contractData;

  const { deprecated, stakedUSD } = user;
  let stakedLPTDeprecated: number = 0;
  if (deprecated) {
    stakedLPTDeprecated = Number(deprecated.stakedLPT);

  }

  const transactionDetails = {
    amount: null,
    pool: assets
      .map(
        (a: { ticker: string; weight: number }) => `${a.ticker} ${a.weight}%`
      )
      .join(", "),
    protocol,
  };

  const openConfirmationModal = () => {
    setConfirmationIsOpen(true);
  };

  const handleTxConfirm = () => {
    dispatch(setIsConfirming(true));
  };
  const handleTxTransact = () => {
    setConfirmationIsOpen(false);
    dispatch(setIsConfirming(false));
    dispatch(setIsTransacting(true));
  };
  const handleTxFinished = () => {
    setCurrentIsTransacting(false);
    dispatch(setIsTransacting(false));
    dispatch(setActiveAction(null));
    dispatch(fetchAllContractData(account));
  };
  const handleTxError = () => {
    setCurrentIsTransacting(false);
    dispatch(setIsConfirming(false));
    dispatch(setIsTransacting(false));
    dispatch(setActiveAction(null));
  };

  const onClaimClicked = async () => {
    if (!stakeContractAddress) {
      console.error("Stake contract address is undefined");
      return;
    }
    if (!account) {
      console.error("User wallet address is undefined");
      return;
    }

    const rewardData = await getRewardData(stakeContractAddress);
    setCurrentIsTransacting(true);
    dispatch(setActiveAction("claim"));
    initiateTransaction(
      alchemySdk,
      rewardData,
      account,
      { ...transactionDetails, type: "claim" },
      handleTxConfirm,
      handleTxTransact,
      handleTxFinished,
      handleTxError,
      walletClient
    );
  };

  const hasUnclaimed = useMemo(() => {
    const unclaimedRewards = rewards.filter((reward: Reward) =>
      new BigNumber(reward.unclaimed).isGreaterThan(0)
    );
    return unclaimedRewards.length > 0;
  }, [rewards]);

  return (
    <div className="flex w-full flex-col gap-2 justify-center rounded-xl bg-black/20 p-4 md:p-4">
      {confirmationIsOpen && (
        <ModalRewards
          activeAction={activeAction}
          isConfirming={isConfirming}
          isTransacting={isTransacting}
          onClaimClick={onClaimClicked}
          onClose={setConfirmationIsOpen}
          protocol={protocol}
          textClaim={"Claim Rewards"}
          contractData={contractData}
          chain={contractData.blockchain}
          unclaimed={0}
        />
      )}
      <section className="flex flex-col gap-4">
        <div className="flex gap-2 items-center">
          <ChainLogo chain={contractData?.blockchain} size={25} />
          <p className="text-sm text-white">{contractData?.blockchain}</p>
        </div>
        <div className="flex flex-col gap-2">
          <CardRewardsUnclaimed rewards={rewards} rewardsInterval={rewardsInterval} protocol={protocol} stakeAddress={stakeContractAddress} />
          <Button
            className=" w-full rounded-lg"
            external={false}
            disabled={!hasUnclaimed || isConfirming || isTransacting}
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

export default CardRewards;
