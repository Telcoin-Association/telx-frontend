import React from "react";
import {
  Alert as AlertIcon,
} from "@transferwise/icons";
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
import initiateTransaction, {
  getRewardData,
} from "../../web3/transactions/transactions";
import { useAccount, useWalletClient } from "wagmi";
import Button from "../common/Button";
import LabelStakeAddressRow from "../common/LabelStakeAddressRow";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import YourDeposits from "../row/YourDeposits";
import YourRewards from "../row/YourRewards";
import UnclaimedRewards from "../row/UnclaimedRewards";
import { alchemySdk } from "@/lib/alchemySdk";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import ChainLogo from "../common/ChainLogo";
import PoolSnapshotAssets from "../pool/PoolSnapshotAssets";
import LabelStatusRow from "../common/LabelStatusRow";
import LabelPositionRow from "../common/LabelPositionRow";
import ProtocolVersionLogo from "../common/ProtocolVersionLogo";
import { getPoolPath } from "@/lib/contracts";

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
    protocol,
    stakeContractAddress,
    poolContractAddress,
    user,
  } = contractData;

  let stakedLPTDeprecated: number = 0;
  if (user?.deprecated) {
    stakedLPTDeprecated = Number(user?.deprecated.stakedLPT);
  }

  const transactionDetails = {
    amount: null,
    pool: assets
      ?.map(
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
    const unclaimedRewards = rewards?.filter((reward: Reward) =>
      new BigNumber(reward.unclaimed).isGreaterThan(0)
    );
    return unclaimedRewards?.length > 0;
  }, [rewards]);

  return (
    <div className="w-full rounded-xl bg-linear-to-r from-[#19245d] to-[#3057A6] p-4">
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
          unclaimed={0}
          chain={contractData.blockchain}
        />
      )}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-6">
          <div className="flex gap-2 justify-between items-center">
            <div className="flex gap-2 items-center">
              <ChainLogo chain={contractData?.blockchain} size={25} />
              <PoolSnapshotAssets contractData={contractData} />
            </div>
            <ProtocolVersionLogo protocol={contractData?.protocol} />
          </div>
          {contractData.deprecated ? null :
            <UnclaimedRewards contractData={contractData} />
          }
          <div className="flex gap-2">
            <Button
              className="w-full rounded-lg"
              external={false}
              linkUrl={getPoolPath(contractData.poolContractAddress, contractData.blockchain, contractData.protocol)}
              type="secondary"
              linkText={
                "View Pool"
              }
            />
            {contractData?.protocol !== "uniswap" &&
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
              />}
          </div>
          {
            // if there is a stakeAddressNew value, then the old staking address is deprecated
            // we then need to notify the user that they need to withdraw LP stake from old contract
            // and restake LP in the new contract
            stakedLPTDeprecated > 0 ? (
              <div className="p-2 border border-status-inProgress rounded-2xl flex flex-col gap-1">
                <div className="flex flex-row items-center text-sm text-status-inProgress">
                  <AlertIcon />
                  <p>Update requires action</p>
                </div>
                <p className=" text-status-inProgress text-xs">
                  You have liquidity staked in a deprecated (previous) mining
                  contract for this pool. The rewards below do not include rewards
                  from the deprecated contract. To receive those rewards, please{" "}
                  <a href={getPoolPath(poolContractAddress, contractData.blockchain, contractData.protocol)}>
                    exit the deprecated contract
                  </a>{" "}
                  on the contract page.
                </p>
              </div>
            ) : null
          }
        </div>
        {rewards && !rewards[0].amount && (
          <p className="text-xs text-status-inProgress border p-2 rounded-2xl">
            For this pool, rewards are calculated off-chain using random,
            periodic snapshots. Accrued rewards will be distributed at the end
            of the period.
          </p>
        )}
        {contractData?.protocol === "uniswap" &&
          <LabelPositionRow contractData={contractData} defaultRewards={defaultRewards} />
        }
        <LabelStatusRow contractData={contractData} defaultRewards={defaultRewards} />
        <LabelStakeAddressRow contractData={contractData} />
        {contractData?.protocol !== "uniswap" &&
          <>
            <YourDeposits
              contractData={contractData}
            />
            <YourRewards
              contractData={contractData}
              defaultRewards={defaultRewards}
            />
          </>
        }
      </section>
    </div>
  );
};

export default CardRewards;
