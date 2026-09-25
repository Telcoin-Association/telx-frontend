import React, { useState } from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { ChevronDown, ChevronUp } from "@transferwise/icons";
import { getAssetImage } from "../pool/PoolWeightChip";
import PositionCard from "./PositionCard";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

export default function LabelPositionRow({ contractData }: { contractData: ProtocolsContractData; defaultRewards: any }) {
  const { positions = [], assets } = contractData;
  const [collapse, setcolaps] = useState(true);
  const [activeTab, setActiveTab] = useState("subscribed");

  const subscribed = positions.filter(
    (p: Position) => Number(p.liquidity) > 0 && p.isSubscribed
  );

  const notSubscribed = positions.filter(
    (p: any) => Number(p.liquidity) > 0 && !p.isSubscribed
  );

  const closed = positions.filter(
    (p: Position) => Number(p.liquidity) === 0
  );

  return (
    positions ?
      <div className="flex flex-col justify-between items-start gap-4 py-3 px-4 text-primary bg-black/20 rounded-2xl w-full!">
        <div className="w-full flex justify-between items-start">
          <div className="flex items-center gap-1">
            <h4 className="text-xs text-primary">Your total positions</h4>
            <p className=" px-2 text-xs group-hover:text-white-100 font-bold">
              {positions.length}
            </p>
          </div>

          {collapse
            ?
            <button onClick={() => setcolaps(false)}>
              <ChevronUp className="cursor-pointer" size={16} />
            </button> :
            <button onClick={() => setcolaps(true)}>
              <ChevronDown className="cursor-pointer" size={16} />
            </button>
          }
        </div>
        <div className={`${collapse ? "hidden" : "block"} w-full`}>
          <div className="my-2 grid grid-cols-3 gap-1">
            <button
              className={`w-full border border-gray-800/20 text-xs cursor-pointer rounded-full ${activeTab === "subscribed" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} py-2 hover:bg-[#0E0E3E]/50`}
              onClick={() => {
                setActiveTab("subscribed");
              }}
            >
              Subscribed ({subscribed.length})
            </button>
            <button
              className={`w-full border border-gray-800/20 text-xs cursor-pointer rounded-full ${activeTab === "unSubscribed" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} py-2 hover:bg-[#0E0E3E]/50`}
              onClick={() => {
                setActiveTab("unSubscribed");
              }}
            >
              UnSubscribed ({notSubscribed.length})
            </button>
            <button
              className={`w-full border border-gray-800/20 text-xs cursor-pointer rounded-full ${activeTab === "closed" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} py-2 hover:bg-[#0E0E3E]/50`}
              onClick={() => {
                setActiveTab("closed");
              }}
            >
              Closed ({closed.length})
            </button>
          </div>
          <div className="w-full">
            {
              positions.length === 0 ?
                <div className="flex items-center justify-center w-full!">
                  <p className="text-base text-primary w-full">No positions subscribed yet. Open the pool, select and subscribe to positions within this pool to start tracking them.</p>
                </div>
                :
                activeTab === "subscribed" ?
                  <div className={`flex flex-col gap-2 w-full transform duration-300 ease-in-out`} >
                    {subscribed?.map((position: any, index: number) => {
                      // determine ticker + image
                      const ticker0Name = assets[0]?.ticker ? assets[0]?.ticker.toLowerCase() : "";
                      const ticker1Name = assets[1]?.ticker ? assets[1]?.ticker.toLowerCase() : "";
                      const image0 = getAssetImage(assets[0]) ?? "";
                      const image1 = getAssetImage(assets[1]);

                      return (
                        <PositionCard key={position.tokenId} position={position} index={index} image0={image0} image1={image1} ticker0Name={ticker0Name} ticker1Name={ticker1Name} />
                      );
                    })}
                  </div> :
                  activeTab === "unSubscribed" ?
                    <div className={`flex flex-col gap-2 w-full transform duration-300 ease-in-out`} >
                      {notSubscribed?.map((position: any, index: number) => {
                        // determine ticker + image
                        const ticker0Name = assets[0]?.ticker ? assets[0]?.ticker.toLowerCase() : "";
                        const ticker1Name = assets[1]?.ticker ? assets[1]?.ticker.toLowerCase() : "";
                        const image0 = getAssetImage(assets[0]) ?? "";
                        const image1 = getAssetImage(assets[1]);

                        return (
                          <PositionCard key={position.tokenId} position={position} index={index} image0={image0} image1={image1} ticker0Name={ticker0Name} ticker1Name={ticker1Name} />
                        );
                      })}
                    </div>
                    :
                    <div className={`flex flex-col gap-2 w-full transform duration-300 ease-in-out`} >
                      {closed?.map((position: any, index: number) => {
                        // determine ticker + image
                        const ticker0Name = assets[0]?.ticker ? assets[0]?.ticker.toLowerCase() : "";
                        const ticker1Name = assets[1]?.ticker ? assets[1]?.ticker.toLowerCase() : "";
                        const image0 = getAssetImage(assets[0]) ?? "";
                        const image1 = getAssetImage(assets[1]);

                        return (
                          <PositionCard key={position.tokenId} position={position} index={index} image0={image0} image1={image1} ticker0Name={ticker0Name} ticker1Name={ticker1Name} />
                        );
                      })}
                    </div>
            }
          </div>
        </div>
      </div >
      :
      null
  );
}