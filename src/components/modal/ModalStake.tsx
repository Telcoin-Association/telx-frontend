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

interface ModalStakeProps {
  activeAction: ActiveAction;
  assets: any;
  stakedLPT: number;
  isConfirming: boolean;
  isTransacting: boolean;
  onClick: any;
  onClose: any;
  protocol: string;
  stakeInputAmount: number;
  textStake: string;
  contractData: ProtocolsContractData;
}

export default function ModalStake(props: ModalStakeProps) {
  const {
    activeAction,
    stakedLPT,
    isConfirming,
    isTransacting,
    onClick,
    onClose,
    stakeInputAmount,
    textStake,
    contractData,
  } = props;

  const stakedAsNumber = new BigNumber(
    typeof stakedLPT === "number" ? stakedLPT : parseFloat(stakedLPT)
  );
  const inputAsNumber = new BigNumber(
    typeof stakeInputAmount === "number"
      ? stakeInputAmount
      : parseFloat(stakeInputAmount)
  );
  const amountAfter = stakedAsNumber.plus(inputAsNumber);

  let inputAsUSD: number | undefined;
  let afterAsUSD: number | undefined;

  if (
    contractData.stakedLiquidity !== null &&
    contractData.stakedLiquidity !== undefined &&
    contractData.totalStaked !== null &&
    contractData.totalStaked !== undefined
  ) {
    const totalStaked = contractData.totalStaked;
    inputAsUSD =
      contractData.stakedLiquidity * (inputAsNumber.toNumber() / totalStaked);
    afterAsUSD =
      contractData.stakedLiquidity * (amountAfter.toNumber() / totalStaked);
  }

  const userStakedUSD = formatNumberToCurrencyString(
    contractData.user.stakedUSD ?? 0
  );

  const shouldShowStakedUSD: boolean =
    contractData.user.stakedUSD !== undefined &&
    contractData.user.stakedUSD !== 0.0;

  return (
    <Modal onClose={onClose} closeButton={false}>
      <div>
        <div className="mx-auto flex flex-col text-center md:w-[560px]">
          <h3 className="py-2 font-bold text-white">Preview Stake LPT</h3>
          <p className="w-[310px] px-4 text-sm text-primary md:mx-auto md:px-0">
            Please review the following information. You will be asked to
            confirm the transaction in your wallet.
          </p>
        </div>
        <div className="mt-5">
          <div className="label-value-rows flex flex-col gap-2">
            <LabelPoolRow contractData={contractData} borderTop={false} />
            <LabelProtocolRow contractData={contractData} />
            <LabelValueRow
              label="Current LPT Stake"
              smallValue
              value={
                <div className="flex items-center justify-between">
                  <p>{stakedAsNumber.toFixed()}</p>
                  <>
                    {shouldShowStakedUSD && (
                      <p className="text-sm font-normal text-primary">
                        {userStakedUSD + "*"}
                      </p>
                    )}
                  </>
                </div>
              }
            />
            <LabelValueRow
              label="Amount to Stake"
              smallValue
              value={
                <div className="flex items-center justify-between">
                  <p>{inputAsNumber.toFixed()}</p>
                  <p className="text-sm font-normal text-primary">
                    {inputAsUSD !== undefined
                      ? formatNumberToCurrencyString(inputAsUSD) + "*"
                      : null}
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
                    {afterAsUSD !== undefined
                      ? formatNumberToCurrencyString(afterAsUSD) + "*"
                      : null}
                  </p>
                </div>
              }
            />
          </div>
          <Button
            className="mt-2 w-full rounded-xl"
            external={false}
            disabled={isConfirming || isTransacting}
            onClick={onClick}
            type="primary"
            linkText={
              (isConfirming || isTransacting) && activeAction === "stake" ? (
                <div className="flex items-center">
                  <LoadingAnimation size={24} theme="dark" />
                  <span className="ml-2 whitespace-nowrap">
                    Confirm Stake in Wallet
                  </span>
                </div>
              ) : (
                textStake
              )
            }
          />
        </div>
        <p className="pt-4 text-center text-xs text-primary">
          *USD conversions are not real time, and are provided as approximates
          only.
        </p>
      </div>
    </Modal>
  );
}
