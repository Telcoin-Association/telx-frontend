import React from "react";
import { ActiveAction } from "../../redux/slices/web3Slice";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import Button from "../common/Button";

interface StakingContractStakeFormStakeProps {
  activeAction: ActiveAction;
  balanceLPT: number;
  handleMaxStake: any;
  handleStake: any;
  handleStakeInputChange: any;
  stakeInputAmount: number;
  stakeInputFilled: boolean;
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

export default function StakingContractStakeFormStake(props: StakingContractStakeFormStakeProps) {
  const {
    activeAction,
    balanceLPT,
    handleMaxStake,
    handleStakeInputChange,
    handleStake,
    stakeInputAmount,
    stakeInputFilled,
    textStake,
    isConfirming,
    isTransacting,
  } = props;

  const isDisabled = isConfirming || isTransacting || !stakeInputFilled || (stakeInputFilled && stakeInputAmount <= 0);

  return (
    <div className=" w-full">
      <div className="flex flex-row justify-between my-2">
        <label className="text-primary text-sm">
          {textStake.helpText}: {isNaN(balanceLPT) ? 0 : balanceLPT} {textStake.helpTextUnit}
        </label>
      </div>
      <div className="flex flex-row rounded-lg border border-white/30 justify-between items-center">
        <div className="border-r-2 border-white/30 py-3 px-3">
          <button
            className="font-bold text-xs text-primary hover:text-primary uppercase cursor-pointer"
            disabled={isConfirming || isTransacting}
            onClick={handleMaxStake}
          >
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
            className="w-full h-full  py-3 px-3 rounded-r-lg  text-white"
          ></input>
        </div>
      </div>
      <Button
        className="rounded-lg my-4 w-full"
        disabled={isDisabled}
        external={false}
        onClick={handleStake}
        type="primary"
        linkText={
          isTransacting && activeAction === "stake" ? (
            <div className="flex items-center">
              <LoadingAnimation size={24} />
              <span className="ml-2 whitespace-nowrap">Stake in Progress</span>
            </div>
          ) : (
            textStake.ctaText
          )
        }
      />
    </div>
  );
}
