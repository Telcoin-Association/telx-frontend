import React from "react";
import { ActiveAction } from "../../redux/slices/web3Slice";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import Button from "../common/Button";

interface ContractStakeFormUnstakeProps {
  activeAction: ActiveAction;
  stakedLPT: number;
  handleMaxUnstake: any;
  handleUnstake: any;
  handleUnstakeInputChange: any;
  unstakeInputAmount: number;
  unstakeInputFilled: boolean;
  textUnstake: {
    title: string;
    type: string;
    helpText: string;
    helpTextAmount: number;
    helpTextUnit: string;
    maxText: string;
    ctaText: string;
  };
  isConfirming: boolean;
  isTransacting: boolean;
}

export default function ContractStakeFormUnstake(props: ContractStakeFormUnstakeProps) {
  const {
    activeAction,
    stakedLPT,
    handleMaxUnstake,
    handleUnstakeInputChange,
    handleUnstake,
    unstakeInputAmount,
    unstakeInputFilled,
    textUnstake,
    isConfirming,
    isTransacting,
  } = props;

  const isDisabled = isConfirming || isTransacting || !unstakeInputFilled || (unstakeInputFilled && unstakeInputAmount <= 0);

  return (
    <>
      <div className="flex flex-row justify-between my-2">
        <label className="text-primary text-sm">
          {textUnstake.helpText}: {isNaN(stakedLPT) ? 0 : stakedLPT} {textUnstake.helpTextUnit}
        </label>
      </div>
      <div className="flex flex-row rounded-lg border border-white/30 justify-between items-center">
        <div className="border-r-2 border-white/30 py-3 px-3 ">
          <button
            className="font-bold text-xs text-primary hover:text-primary uppercase cursor-pointer"
            disabled={isConfirming || isTransacting}
            onClick={handleMaxUnstake}
          >
            {textUnstake.maxText}
          </button>
        </div>
        <div className="w-full h-full">
          <input
            disabled={isConfirming || isTransacting}
            type="number"
            value={unstakeInputAmount}
            placeholder="0"
            onChange={handleUnstakeInputChange}
            className="w-full h-full  py-3 px-3 rounded-r-lg text-white"
          ></input>
        </div>
      </div>
      <Button
        className="rounded-lg my-4 w-full"
        disabled={isDisabled}
        external={false}
        onClick={handleUnstake}
        type="primary"
        linkText={
          isTransacting && activeAction === "unstake" ? (
            <div className="flex items-center">
              <LoadingAnimation size={24} />
              <span className="ml-2 whitespace-nowrap">Unstake in Progress</span>
            </div>
          ) : (
            textUnstake.ctaText
          )
        }
      />
    </>
  );
}
