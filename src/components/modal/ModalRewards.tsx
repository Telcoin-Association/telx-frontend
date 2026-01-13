import React from "react";
import { ActiveAction } from "../../redux/slices/web3Slice";
import Modal from "../common/Modal";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelProtocolRow from "../common/LabelProtocolRow";
import Button from "../common/Button";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import UnclaimedRewards from "../row/UnclaimedRewards";
import ChainLogo from "../common/ChainLogo";
import PoolSnapshotAssets from "../pool/PoolSnapshotAssets";
import ContractReward from "../contract/ContractReward";

interface ModalRewardsProps {
  activeAction: ActiveAction;
  isConfirming: boolean;
  isTransacting: boolean;
  onClaimClick: any;
  onClose: any;
  textClaim: string;
  chain: string;
  unclaimed: number;
  contractData?: ProtocolsContractData;
  protocol: string;
}
export default function ModalRewards(props: ModalRewardsProps) {
  const { activeAction, isConfirming, isTransacting, onClaimClick, onClose, textClaim, chain, unclaimed, contractData, protocol } = props;

  return (
    <Modal onClose={onClose} closeButton={false}>
      <div className="px-3">
        <div className="justify-center flex flex-col mx-auto items-center text-center max-w-md">
          <h3 className="font-bold text-base text-white pb-2">Preview Rewards Claim</h3>
          <p className="text-primary text-sm px-4 md:px-10 max-w-[24rem]">
            Please review the following information. You will be asked to confirm the transaction in your wallet.
          </p>
        </div>

        <div className="rewards-detail">
          <div className="label-value-rows flex flex-col gap-2">
            <div className="py-2 flex gap-4 border-b-[0.60px] border-white/20">
              <div className="flex items-center">
                <ChainLogo chain={chain} size={25} />
              </div>
              <PoolSnapshotAssets contractData={contractData} />
            </div>
            <LabelProtocolRow contractData={contractData} />
            {protocol === "uniswap" ?
              <ContractReward amount={unclaimed} ticker={"TEL"} includeConversion={true} flex />
              :
              <UnclaimedRewards contractData={contractData} />
            }
            <Button
              className="rounded-lg w-full"
              external={false}
              disabled={isConfirming || isTransacting}
              onClick={onClaimClick}
              type="primary"
              linkText={
                (isConfirming || isTransacting) && activeAction === "claim" ? (
                  <div className="flex items-center">
                    <LoadingAnimation size={24} className="mt-2" theme="dark" />
                    <span className="ml-2 whitespace-nowrap">Confirm Rewards in Wallet</span>
                  </div>
                ) : (
                  textClaim
                )
              }
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
