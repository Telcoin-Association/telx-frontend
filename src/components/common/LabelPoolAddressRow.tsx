import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";

export default function LabelPoolAddressRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { poolContractAddress, blockchain, protocol } = contractData;

  return poolContractAddress ? (
    <div className="bg-black/20 rounded-2xl p-4 flex flex-col gap-1">
      <h4 className="text-sm text-primary">
        Pool Address
      </h4>
      {protocol !== "uniswap"
        ?
        <>
          {blockchain === "base" ?
            <a
              href={`https://basescan.org/address/${poolContractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs break-all text-blue-700 hover:text-burple-600"
            >
              {poolContractAddress}
            </a>
            :
            <a
              href={`https://polygonscan.com/address/${poolContractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs break-all text-blue-700 hover:text-burple-600"
            >
              {poolContractAddress}
            </a>
          }
        </> :
        <>
          <p
            className="text-xs break-all text-primary"
          >
            {poolContractAddress}
          </p>
        </>
      }
    </div>
  ) : (
    <></>
  );
}
