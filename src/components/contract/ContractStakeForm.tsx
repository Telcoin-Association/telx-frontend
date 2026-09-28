"use client";

import React, { BaseSyntheticEvent, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { fetchAllContractData } from "../../redux/slices/contractsSlice";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  web3Selector,
  setActiveAction,
  setIsConfirming,
  setIsTransacting,
} from "../../redux/slices/web3Slice";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import initiateTransaction, {
  getApprovalData,
  getStakeData,
  getWithdrawData,
} from "../../web3/transactions/transactions";
import Approve from "./ContractApprove";
import Stake from "./ContractStakeFormStake";
import ModalStake from "../modal/ModalStake";
import Unstake from "./ContractStakeFormUnstake";
import UnModalStake from "../modal/ModalUnstake";
import { ZERO_TOKEN_BALANCE } from "@/lib/constants";

const textStake = {
  title: "Stake",
  type: "stake",
  helpText: "Wallet Balance",
  helpTextUnit: "LP",
  maxText: "Max",
  ctaText: "Confirm Stake LPT",
};

const textUnstake = {
  title: "Unstake",
  type: "unstake",
  helpText: "Currently Staked",
  helpTextAmount: 0,
  helpTextUnit: "LP",
  maxText: "Max",
  ctaText: "Confirm Unstake LPT",
};

interface ContractStakeFormProps {
  poolContractAddress: string;
  stakeContractAddress: string;
  selectedWalletAddress: string;
  contractApproved: boolean;
  selectedPool: ProtocolsContractData;
  protocol: string;
}

const ContractStakeForm = (props: ContractStakeFormProps) => {
  const {
    poolContractAddress,
    stakeContractAddress,
    contractApproved,
    selectedPool,
    protocol,
  } = props;
  const { assets } = selectedPool;
  const { activeAction, isConfirming, isTransacting } =
    useAppSelector(web3Selector);
  const dispatch = useAppDispatch();
  const { address: account } = useAccount();
  const { data: walletClient } = useWalletClient();

  const rawBalanceLPT: string | number =
    selectedPool.user?.balanceLPT?.toString() === ZERO_TOKEN_BALANCE
      ? 0
      : selectedPool.user?.balanceLPT ?? 0;
  const rawStakedLPT: string | number =
    selectedPool.user?.stakedLPT?.toString() === ZERO_TOKEN_BALANCE
      ? 0
      : selectedPool.user?.stakedLPT ?? 0;

  let balanceLPT: number = 0;
  let stakedLPT: number = 0;

  if (protocol === "balancer" || protocol === "dfx") {
    if (rawBalanceLPT && typeof rawBalanceLPT === "string") {
      balanceLPT = parseFloat(
        rawBalanceLPT.substring(0, rawBalanceLPT.length - 11)
      );
    } else balanceLPT = rawBalanceLPT as number;
    if (rawStakedLPT && typeof rawStakedLPT === "string") {
      stakedLPT = parseFloat(
        rawStakedLPT.substring(0, rawStakedLPT.length - 11)
      );
    } else stakedLPT = rawStakedLPT as number;
  } else {
    balanceLPT = rawBalanceLPT as number;
    stakedLPT = rawStakedLPT as number;
  }

  const [stakeInputFilled, setStakeInputFilled] = useState(false);
  const [unstakeInputFilled, setUnstakeInputFilled] = useState(false);
  const [stakeInputAmount, setStakeInputAmount] = useState(0);
  const [unstakeInputAmount, setUnstakeInputAmount] = useState(0);
  const [stakeConfirmationIsOpen, setStakeConfirmationIsOpen] = useState(false);
  const [unstakeConfirmationIsOpen, setUnstakeConfirmationIsOpen] =
    useState(false);
  // used for displaying details on the transaction notification (toast)
  const transactionDetails = {
    stakeAmount: stakeInputAmount,
    unstakeAmount: unstakeInputAmount,
    pool:
      selectedPool?.assets
        ?.map((a: any) => `${a.ticker} ${a.weight}%`)
        .join(", ") || null,
    protocol,
  };

  const handleStakeInputChange = (event: BaseSyntheticEvent) => {
    setStakeInputAmount(parseFloat(event.target.value) || 0);
    setStakeInputFilled(event.target.value.length > 0);
  };

  const handleUnstakeInputChange = (event: BaseSyntheticEvent) => {
    setUnstakeInputAmount(parseFloat(event.target.value) || 0);
    setUnstakeInputFilled(event.target.value.length > 0);
  };

  const handleMaxStake = () => {
    setStakeInputAmount(balanceLPT);
    setStakeInputFilled(balanceLPT > 0);
  };

  const handleMaxUnstake = () => {
    setUnstakeInputAmount(stakedLPT);
    setUnstakeInputFilled(stakedLPT > 0);
  };

  /* event handlers for initiateMetaMaskTransaction */
  const handleTxConfirm = () => {
    dispatch(setIsConfirming(true));
  };
  const handleTxTransact = () => {
    setStakeConfirmationIsOpen(false);
    setUnstakeConfirmationIsOpen(false);
    dispatch(setIsConfirming(false));
    dispatch(setIsTransacting(true));
  };
  const handleTxFinished = () => {
    dispatch(setIsTransacting(false));
    dispatch(setActiveAction(null));

    // clear relevant input
    setStakeInputAmount(0);
    setUnstakeInputAmount(0);

    dispatch(fetchAllContractData(account));
  };
  const handleTxError = () => {
    dispatch(setIsConfirming(false));
    dispatch(setIsTransacting(false));
    dispatch(setActiveAction(null));
  };
  /* end event handlers for initiateMetaMaskTransaction */

  const handleApprove = async () => {
    if (!account) {
      console.error("User wallet address is undefined");
      return;
    }
    const approvalData = await getApprovalData(
      poolContractAddress,
      stakeContractAddress
    );
    dispatch(setActiveAction("approve"));
    initiateTransaction(
      approvalData,
      account,
      { ...transactionDetails, type: "approve" },
      handleTxConfirm,
      handleTxTransact,
      handleTxFinished,
      handleTxError,
      walletClient
    );
  };

  const handleStake = async () => {
    if (!account) {
      console.error("User wallet address is undefined");
      return;
    }
    const stakeData = getStakeData(stakeContractAddress, stakeInputAmount);
    dispatch(setActiveAction("stake"));
    initiateTransaction(
      stakeData,
      account,
      { ...transactionDetails, type: "stake" },
      handleTxConfirm,
      handleTxTransact,
      handleTxFinished,
      handleTxError,
      walletClient
    );
  };

  const handleUnstake = async () => {
    if (!account) {
      console.error("User wallet address is undefined");
      return;
    }

    const widthdrawData = await getWithdrawData(
      stakeContractAddress,
      unstakeInputAmount,
      account
    );
    dispatch(setActiveAction("unstake"));
    initiateTransaction(
      widthdrawData,
      account,
      { ...transactionDetails, type: "unstake" },
      handleTxConfirm,
      handleTxTransact,
      handleTxFinished,
      handleTxError,
      walletClient
    );
  };

  return (
    <div>
      {stakeConfirmationIsOpen && (
        <ModalStake
          activeAction={activeAction}
          assets={assets}
          stakedLPT={stakedLPT}
          isConfirming={isConfirming}
          isTransacting={isTransacting}
          onClick={handleStake}
          onClose={setStakeConfirmationIsOpen}
          protocol={protocol}
          stakeInputAmount={stakeInputAmount}
          textStake={textStake.ctaText}
          contractData={selectedPool}
        />
      )}
      {unstakeConfirmationIsOpen && (
        <UnModalStake
          activeAction={activeAction}
          assets={assets}
          stakedLPT={stakedLPT}
          isConfirming={isConfirming}
          isTransacting={isTransacting}
          onClick={handleUnstake}
          onClose={setUnstakeConfirmationIsOpen}
          protocol={protocol}
          unstakeInputAmount={unstakeInputAmount}
          textUnstake={textUnstake.ctaText}
          contractData={selectedPool}
        />
      )}
      <div className="flex flex-col gap-4 md:flex-row w-full md:gap-10">
          <div className="w-full">
            {contractApproved ? (
              <Stake
                activeAction={activeAction}
                balanceLPT={balanceLPT}
                handleMaxStake={handleMaxStake}
                handleStakeInputChange={handleStakeInputChange}
                handleStake={() => setStakeConfirmationIsOpen(true)}
                isConfirming={isConfirming}
                isTransacting={isTransacting}
                stakeInputAmount={stakeInputAmount}
                stakeInputFilled={stakeInputFilled}
                textStake={textStake}
              />
            ) : (
              <Approve
                activeAction={activeAction}
                balanceLPT={balanceLPT}
                handleApprove={handleApprove}
                handleMaxStake={handleMaxStake}
                handleStakeInputChange={handleStakeInputChange}
                isConfirming={isConfirming}
                isTransacting={isTransacting}
                stakeInputAmount={stakeInputAmount}
                textStake={textStake}
              />
            )}
          </div>
          <div className="w-full">
            {contractApproved ? (
              <Unstake
                activeAction={activeAction}
                handleMaxUnstake={handleMaxUnstake}
                handleUnstakeInputChange={handleUnstakeInputChange}
                handleUnstake={() => setUnstakeConfirmationIsOpen(true)}
                isConfirming={isConfirming}
                isTransacting={isTransacting}
                stakedLPT={stakedLPT}
                textUnstake={textUnstake}
                unstakeInputAmount={unstakeInputAmount}
                unstakeInputFilled={unstakeInputFilled}
              />
            ) : (
              <Approve
                activeAction={activeAction}
                balanceLPT={balanceLPT}
                handleApprove={handleApprove}
                handleMaxStake={handleMaxStake}
                handleStakeInputChange={handleStakeInputChange}
                isConfirming={isConfirming}
                isTransacting={isTransacting}
                stakeInputAmount={stakeInputAmount}
                textStake={textStake}
              />
            )}
          </div>
      </div>
    </div>
  );
};

export default ContractStakeForm;
