import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import HelpTip from "./HelpTip";

export const POOL_ID_HELP = "Uniswap v4 pools are identified by an ID in the PoolManager, not a contract address.";

/**
 * The pool's identifier. A Uniswap v4 pool has no contract of its own: it is identified by its 32-byte pool ID in
 * the PoolManager, shown as text. The legacy pools are contracts, shown as their address with an explorer link.
 */
export default function LabelPoolAddressRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { poolContractAddress, blockchain, protocol } = contractData;

  return poolContractAddress ? (
    <div className="bg-black/20 rounded-2xl p-4 flex flex-col gap-1">
      {protocol === "uniswap" ? (
        <div className="flex items-center gap-1">
          <h4 className="text-sm text-primary">Pool ID</h4>
          <HelpTip text={POOL_ID_HELP} label="About the pool ID" />
        </div>
      ) : (
        <h4 className="text-sm text-primary">Pool Address</h4>
      )}
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
