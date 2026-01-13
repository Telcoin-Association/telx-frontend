import React from "react";
import { ActiveAction } from "../../redux/slices/web3Slice";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import Button from "../common/Button";

interface StakingContractApproveProps {
  activeAction: ActiveAction;
  balanceLPT: number;
  handleApprove: any;
  handleMaxStake: any;
  handleStakeInputChange: any;
  stakeInputAmount: number;
  textStake: {
    title: string;
    type: string;
    helpText: string;
    helpTextUnit: string;
    maxText: string;
    ctaText: string;
  };
  isConfirming: boolean;
  isTransacting: boolean;
}

export default function StakingContractApprove(props: StakingContractApproveProps) {
  const {
    activeAction,
    textStake,
    balanceLPT,
    handleMaxStake,
    stakeInputAmount,
    handleStakeInputChange,
    handleApprove,
    isConfirming,
    isTransacting,
  } = props;
  return (
    <>
      <div className="flex flex-row justify-between my-2">
        <h4 className="text-primary font-bold">{textStake.title}</h4>
        <label className="text-primary text-sm">
          {textStake.helpText}: {balanceLPT} {textStake.helpTextUnit}
        </label>
      </div>
      <div className="flex flex-row bg-white-100 rounded-lg border border-gray-400 justify-between items-center">
        <div className="border-r-2 border-gray-400 py-3 px-3 ">
          <button className="font-bold text-xs text-gray-700 hover:text-primary uppercase" onClick={handleMaxStake}>
            {textStake.maxText}
          </button>
        </div>
        <div className="w-full h-full">
          <input
            disabled={isConfirming || isTransacting}
            type="number"
            value={stakeInputAmount}
            placeholder="0"
            onChange={handleStakeInputChange}
            className="w-full h-full py-3 px-3 rounded-r-lg"
          ></input>
        </div>
      </div>
      <Button
        className="rounded-lg my-4 w-full"
        disabled={isConfirming || isTransacting}
        external={false}
        onClick={handleApprove}
        linkText={
          (isConfirming || isTransacting) && activeAction === "approve" ? (
            <div className="flex items-center">
              <LoadingAnimation size={24} />
              <span className="ml-2 whitespace-nowrap">{isTransacting ? "Approve in Progress" : "Confirm Approval in Wallet"}</span>
            </div>
          ) : (
            "Approve"
          )
        }
      />
    </>
  );
}
