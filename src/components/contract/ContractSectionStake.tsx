"use client";
import React, { useState, useEffect } from "react";
import RichText from "../common/RichText";

// web3
import { useAppSelector } from "@/redux/hooks";
import { web3Selector } from "../../redux/slices/web3Slice";
import { getAllowanceBool } from "../../web3/transactions/transactions";
import { useAccount } from "wagmi";

// components
import ContractStakeForm from "./ContractStakeForm";
import NoticeIconHelpText from "../common/NoticeIconHelpText";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import UserPositions from "../common/UserPositions";

export const contractsWithoutStaking = [
  "TEL 50 BAL 50",
  "TEL 60 BAL 20 USDC 20",
];

export interface ContractProps {
  selectedPool: ProtocolsContractData;
  defaultRewards?: any;
  notices?: any;
  currentPoolAddress: string;
}

const ContractSectionStake = (props: ContractProps) => {
  const { selectedPool, notices, currentPoolAddress } = props;
  const { address } = useAccount();
  const { isTransacting } = useAppSelector(web3Selector);
  const [contractApproved, setContractApproved] = useState(false);
  const hasAccount = !!address && address.length > 0;

  const {
    activeStakingAddress,
    deprecatedContractPresent,
    name,
    stakeContractAddress,
    poolContractAddress,
    protocol,
    deprecated,
  } = selectedPool;

  const noWalletNotice = notices.filter(
    (notice: any) => notice.attributes.notice_id === "wallet-not-detected"
  );
  const {
    title: textWalletNotDetectedTitle,
    description: textWalletNotDetectedDescription,
  } = noWalletNotice[0]?.attributes || {};

  const stakeRequired = notices.filter(
    (notice: any) => notice.attributes.notice_id === "stake-required"
  );
  const { description: textStakeRequired } = stakeRequired[0]?.attributes || {};

  const noStakeRequired = notices.filter(
    (notice: any) => notice.attributes.notice_id === "stake-not-required"
  );
  const { description: textStakeNotRequired } =
    noStakeRequired[0]?.attributes || {};

  useEffect(() => {
    const checkIfContractApproved = async () => {
      if (
        hasAccount &&
        // some pools don't have staking addresses, so we don't need to check contract approval
        // TEL/BAL and TEL/BAL/USDC are examples of this
        !contractsWithoutStaking.includes(name)
      ) {
        if (stakeContractAddress) {
          const contractApprovedResponse = await getAllowanceBool(
            poolContractAddress,
            address,
            stakeContractAddress
          );
          setContractApproved(contractApprovedResponse);
        }
      }
    };
    checkIfContractApproved();
  }, [
    isTransacting,
    hasAccount,
    name,
    poolContractAddress,
    address,
    stakeContractAddress,
  ]);

  return (
    <div>
      {selectedPool?.protocol === "uniswap" ? (
        <>
          <UserPositions selectedPool={selectedPool} currentPoolAddress={currentPoolAddress} />
          <RichText
            className="text-primary"
            markdown={`### TEL Incentive Participation Overview\n\nTo qualify for TEL rewards, your liquidity position must be created using the configuration defined by the incentive program. Check the PoolId you provide liquidity to on Uniswap matches the one printed on this page. <br><br> Users are required to subscribe their position on TELx to receive rewards and earn voting power in the TELx governance system.<br><br> <b>Adding Liquidity on Uniswap: </b><br> Follow the instructions for adding liquidity to Uniswap V4 pools [here](/about/how-do-i-provide-liquidity).`}
          />
        </>
      ) : (
        <>
          <div className="text-primary">
            {contractsWithoutStaking.includes(name) ? (
              <RichText markdown={textStakeNotRequired} />
            ) : (
              <RichText markdown={textStakeRequired} />
            )}
          </div>
          {!contractsWithoutStaking.includes(name) &&
            (hasAccount ? (
              // if there is a deprecated address
              deprecatedContractPresent || deprecated ? (
                // check to see if there is a new staking address
                stakeContractAddress && activeStakingAddress ? (
                  <ContractStakeForm
                    contractApproved={contractApproved}
                    poolContractAddress={poolContractAddress}
                    stakeContractAddress={stakeContractAddress}
                    selectedPool={selectedPool}
                    selectedWalletAddress={address}
                    protocol={protocol}
                  />
                ) : // if no address exists, it is an airdrop contract, and we don't display stake/unstake
                  null
              ) : (
                // if no deprecated address, just display the original stake/unstake form
                stakeContractAddress && (
                  <ContractStakeForm
                    contractApproved={contractApproved}
                    poolContractAddress={poolContractAddress}
                    stakeContractAddress={stakeContractAddress}
                    selectedPool={selectedPool}
                    selectedWalletAddress={address}
                    protocol={protocol}
                  />
                )
              )
            ) : (
              <NoticeIconHelpText
                title={textWalletNotDetectedTitle}
                description={textWalletNotDetectedDescription}
              />
            ))}
        </>
      )}
    </div>
  );
};

export default ContractSectionStake;