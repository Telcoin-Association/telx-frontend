import React from "react";
import BigNumber from "bignumber.js";
import { ActiveAction } from "../../redux/slices/web3Slice";
import Modal from "../common/Modal";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import LabelValueRow from "../common/LabelValueRow";
import LabelProtocolRow from "../common/LabelProtocolRow";
import LabelPoolRow from "../common/LabelPoolRow";
import Button from "../common/Button";
import LoadingAnimation from "../common/LoadingAnimationCircle";

interface ModalUnstakeProps {
  activeAction: ActiveAction;
  assets: any;
  stakedLPT: number;
  isConfirming: boolean;
  isTransacting: boolean;
  onClick: any;
  onClose: any;
  protocol: string;
  unstakeInputAmount: number;
  textUnstake: string;
  contractData: ProtocolsContractData;
}

export default function ModalUnstake(props: ModalUnstakeProps) {
  const { activeAction, stakedLPT, isConfirming, isTransacting, onClick, onClose, unstakeInputAmount, textUnstake, contractData } = props;

  const stakedAsNumber = new BigNumber(typeof stakedLPT === "number" ? stakedLPT : parseFloat(stakedLPT));
  const inputAsNumber = new BigNumber(typeof unstakeInputAmount === "number" ? unstakeInputAmount : parseFloat(unstakeInputAmount));
  const amountAfter = stakedAsNumber.minus(inputAsNumber);

  let inputAsUSD: number | undefined;
  let afterAsUSD: number | undefined;

  if (contractData?.totalLiquidity && contractData?.stakedLiquidity && contractData.totalStaked) {
    inputAsUSD = contractData.stakedLiquidity * (inputAsNumber.toNumber() / contractData.totalStaked);
    afterAsUSD = contractData.stakedLiquidity * (amountAfter.toNumber() / contractData.totalStaked);
  }

  const userStakedUSD = formatNumberToCurrencyString(contractData.user.stakedUSD ?? 0);
  const shouldShowStakedUSD: boolean = contractData.user.stakedUSD !== undefined && contractData.user.stakedUSD !== 0.0;

  return (
    <Modal onClose={onClose} closeButton={false}>
      <div>
        <div className="mx-auto flex flex-col text-center md:w-[560px]">
          <h3 className="pb-2 font-bold text-white">Preview Unstake LPT</h3>
          <p className="w-[310px] px-4 text-sm text-primary md:mx-auto md:px-0">
            Please review the following information. You will be asked to confirm the transaction in your wallet.
          </p>
        </div>
        <div className="mt-5">
          <div className="label-value-rows flex flex-col gap-2">
            <LabelPoolRow borderTop={false} contractData={contractData} />
            <LabelProtocolRow contractData={contractData} />
            <LabelValueRow
              label="Current LPT Stake"
              smallValue
              value={
                <div className="flex items-center justify-between">
                  <p>{stakedAsNumber.toFixed()}</p>
                  {shouldShowStakedUSD && <p className="text-sm font-normal text-primary">{userStakedUSD + "*"}</p>}
                </div>
              }
            />
            <LabelValueRow
              label="Amount to Unstake"
              smallValue
              value={
                <div className="flex items-center justify-between">
                  <p>{inputAsNumber.toFixed()}</p>
                  <p className="text-sm font-normal text-primary">
                    {inputAsUSD !== undefined ? formatNumberToCurrencyString(inputAsUSD) + "*" : null}
                  </p>
                </div>
              }
            />
            <LabelValueRow
              label="New LPT Stake"
              smallValue
              value={
                <div className="flex items-center justify-between">
                  <p>{amountAfter.toFixed()}</p>
                  <p className="text-sm font-normal text-primary">
                    {afterAsUSD !== undefined ? formatNumberToCurrencyString(afterAsUSD) + "*" : null}
                  </p>
                </div>
              }
            />
            <Button
              className="mt-2 w-full rounded-xl"
              external={false}
              disabled={isConfirming || isTransacting}
              onClick={onClick}
              type="primary"
              linkText={
                (isConfirming || isTransacting) && activeAction === "unstake" ? (
                  <div className="flex items-center">
                    <LoadingAnimation size={24} theme="dark" />
                    <span className="ml-2 whitespace-nowrap">Confirm Unstake in Wallet</span>
                  </div>
                ) : (
                  textUnstake
                )
              }
            />
          </div>
        </div>
        <p className="pt-4 text-center text-xs text-primary">*USD conversions are not real time, and are provided as approximates only.</p>
      </div>
    </Modal>
  );
}
