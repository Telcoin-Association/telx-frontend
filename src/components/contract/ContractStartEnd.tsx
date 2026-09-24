import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { useMemo } from "react";

export function formatStakingContractDate(date: string) {
  const result = new Date(date);
  return result.toUTCString().split(" ").slice(1, 4).join(" ");
}

export default function ContractStartEnd({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {

  const startDate = useMemo(() => {
    if (
      contractData &&
      contractData.deprecated &&
      contractData.deprecatedStakingAddresses &&
      contractData.deprecatedStakingAddresses?.length > 0
    ) {
      const latestStartDate =
        contractData.deprecatedStakingAddresses[
          contractData.deprecatedStakingAddresses.length - 1
        ]?.start_date;
      return formatStakingContractDate(latestStartDate);
    } else if (contractData && contractData.activeStakingAddress?.start_date) {
      return formatStakingContractDate(
        contractData.activeStakingAddress.start_date
      );
    }
    return "";
  }, [contractData]);

  const endDate = useMemo(() => {
    if (
      contractData?.deprecated &&
      contractData.deprecatedStakingAddresses &&
      contractData.deprecatedStakingAddresses?.length > 0
    ) {
      const latestEndDate =
        contractData.deprecatedStakingAddresses[
          contractData.deprecatedStakingAddresses.length - 1
        ]?.end_date;
      return formatStakingContractDate(latestEndDate);
    }
    return "Present";
  }, [contractData?.deprecated, contractData?.deprecatedStakingAddresses]);

  if (contractData?.protocol === "uniswap") return null;

  return (
    <p className="text-sm text-white font-base">{`${startDate} - ${endDate}`}</p>
  );
}

export function organisedDate(date: string) {
  const result = new Date(date);
  const day = result.getDate();
  const month = result.toLocaleString("default", { month: "short" });
  const year = result.getFullYear();

  return `${day} ${month} ${year}`;
}
