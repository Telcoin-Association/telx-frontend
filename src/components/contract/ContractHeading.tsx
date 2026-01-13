import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import ContractUpdateRequiresAction from "./ContractUpdateRequiresAction";
import PoolIdentity from "../common/PoolIdentity";
import ReturnStatus from "../common/ReturnStatus";
import ContractStartEnd from "./ContractStartEnd";
import ReturnLogo from "../common/ReturnLogo";

export function formatStakingContractDate(date: string) {
  const result = new Date(date);
  return result.toUTCString().split(" ").slice(1, 4).join(" ");
}

interface ContractHeadingProps {
  contractData: ProtocolsContractData; // @FIXME
  contractLink?: boolean;
  deprecated?: boolean;
  slug?: string;
  displayPoolAddress?: boolean;
  displayStakeAddress?: boolean;
}
const ContractHeading = (props: ContractHeadingProps) => {
  const { contractData, contractLink, slug, displayPoolAddress, displayStakeAddress } = props;
  const { protocol, deprecated } = contractData;

  return (
    <div className="flex flex-col md:flex-row justify-between mb-5">
      <div>
        <PoolIdentity
          contractData={contractData}
          contractLink={contractLink}
          slug={slug}
          displayPoolAddress={displayPoolAddress}
          displayStakeAddress={displayStakeAddress}
        />
      </div>
      <div className="flex flex-col md:items-end space-y-1">
        {protocol ? <ReturnLogo brand={protocol} /> : null}
        <ReturnStatus status={deprecated ? "deprecated" : "active"} />
        <ContractStartEnd contractData={contractData} />
        <ContractUpdateRequiresAction contractData={contractData} />
      </div>
    </div>
  );
};

export default ContractHeading;
