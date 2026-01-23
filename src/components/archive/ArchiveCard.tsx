import React from "react";
import { useRouter } from "next/navigation";
import { organisedDate } from "../contract/ContractStartEnd";
import { shortenAddress } from "@/helpers/shortenAddress";
import PoolSnapshotAssets from "../pool/PoolSnapshotAssets";
import ContractStartEnd from "../contract/ContractStartEnd";
import ChainLogo from "../common/ChainLogo";
import ProtocolVersionLogo from "../common/ProtocolVersionLogo";
import { ProtocolsContractData } from "@/web3/getContracts/shared";

interface ArchiveCardProps {
  contractData: ProtocolsContractData;
  key?: any;
  isLast?: boolean;
  isFirst?: boolean;
}

export default function ArchiveCard(props: ArchiveCardProps) {
  const { contractData } = props;
  const router = useRouter();

  if (!contractData) {
    return null;
  }

  const url = `/pool/${contractData.poolContractAddress}`;

  const openUrl = (url: string) => router.push(url);
  const _protocol = contractData?.protocol ?? "";

  return (
    <div style={{ position: "relative" }} onClick={() => openUrl(url)} className="cursor-pointer">
      <div
        className={`mx-auto grid w-full cursor-pointer grid-cols-[0.3fr_1fr_0.5fr_1fr_1fr_1fr] items-center justify-between bg-linear-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 px-4 py-4 backdrop-blur hover:bg-white/5! lg:grid-cols-[0.4fr_2.5fr_0.5fr_1fr_1fr_1fr] ${props.isLast ? "rounded-b-2xl" : ""} ${props.isFirst ? "rounded-t-2xl" : "" } `}
      >
        <div className="flex justify-start">
          <ChainLogo chain={contractData?.blockchain} />
        </div>
        <PoolSnapshotAssets contractData={contractData} />
        <ProtocolVersionLogo protocol={contractData?.protocol} />
        <div>
          {contractData.deprecated ? (
            <p className="text-sm text-gray-700">Pool Archived</p>
          ) : (
            <p className="text-status-complete! text-sm">Pool Active</p>
          )}
          {<p className="text-sm text-gray-700">Contract Archived</p>}
        </div>
        <div>
          {contractData.activeStakingAddress && contractData.activeStakingAddress?.address && (
            <a
              className="text-sm text-blue-700"
              href={`https://polygonscan.com/address/${contractData.activeStakingAddress.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {shortenAddress(contractData.activeStakingAddress.address)}
            </a>
          )}

          {contractData.deprecatedStakingAddresses && contractData.deprecatedStakingAddresses.length > 0 && (
            <div className="space-y-1">
              {contractData.deprecatedStakingAddresses.map((deprecatedAddress, index) => (
                <div key={index}>
                  {deprecatedAddress.address && <p className="text-sm text-gray-700">{shortenAddress(deprecatedAddress.address)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          {contractData.protocol === "uniswap" ? (
            <div className="space-y-1">
              <div className="flex text-sm">
                <p className="font-base text-sm text-gray-700">{`${`${contractData.stakingPeriod}`}`}</p>
              </div>
            </div>
          ) : (
            <>
              {contractData.activeStakingAddress && contractData.activeStakingAddress?.address && <ContractStartEnd contractData={contractData} />}
              {contractData.deprecatedStakingAddresses && contractData.deprecatedStakingAddresses.length > 0 && (
                <div className="space-y-1">
                  {contractData.deprecatedStakingAddresses.map((deprecatedAddress, index) => (
                    <div key={index} className="flex text-sm">
                      {deprecatedAddress.start_date && <p className="text-sm text-gray-700">{organisedDate(deprecatedAddress.start_date)}</p>}
                      {deprecatedAddress.end_date && (
                        <p className="text-gray-700">
                          &nbsp;-&nbsp;
                          {organisedDate(deprecatedAddress.end_date)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
