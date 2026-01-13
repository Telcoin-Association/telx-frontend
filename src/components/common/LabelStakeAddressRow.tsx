import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { contractsWithoutStaking } from "../contract/ContractSectionStake";

interface Props {
  contractData: ProtocolsContractData;
  borderBottom?: boolean;
}

const LabelStakeAddressRow: React.FC<Props> = ({ contractData }) => {
  const { stakeContractAddress, name = null } = contractData;

  return (
    stakeContractAddress ?
      <div className="flex flex-col gap-1 py-3 px-4 text-primary bg-black/20 rounded-2xl">
        <h4 className="text-xs text-primary" > Stake Address</h4>
        <div className="text-xs text-blue-700 hover:text-burple-600 break-all">
          {stakeContractAddress && name && !contractsWithoutStaking.includes(name) && (
            <a href={`https://polygonscan.com/address/${stakeContractAddress}`} target="_blank" rel="noreferrer">
              {stakeContractAddress}
            </a>
          )}
        </div>
      </div > : null
  );
};

export default LabelStakeAddressRow;
