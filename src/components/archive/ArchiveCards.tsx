"use client";

import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import ArchiveSnapshotLabels from "./ArchiveSnapshotLabels";
import LoadingWrapper from "../common/LoadingWrapper";
import ArchiveCard from "./ArchiveCard";

interface ArchiveCardsProps {
  contractsData: ProtocolsContractData[];
  endListText?: boolean;
  displayLabels?: boolean;
}

const ArchiveCards = (props: ArchiveCardsProps) => {
  const { contractsData, endListText = true, displayLabels = true } = props;
  return (
    <div>
      {contractsData?.length > 0 ? (
        <div className="">
          <div className="overflow-x-auto rounded-2xl shadow-2xl">
            <div className="mx-auto w-full max-w-7xl min-w-5xl rounded-2xl border border-white/10">
              <div className="min-w-5xl">{displayLabels && <ArchiveSnapshotLabels />}</div>
              {contractsData?.map((contractData: any, i: number) => {
                return <ArchiveCard key={i} contractData={contractData} isLast={i === contractsData?.length - 1} />;
              })}
            </div>
          </div>
          {endListText && (
            <div className="flex h-20 w-full flex-col justify-center text-sm">
              <p className="text-white-100 mx-auto px-5">End of the List</p>
            </div>
          )}
        </div>
      ) : (
        <LoadingWrapper />
      )}
    </div>
  );
};

export default ArchiveCards;
