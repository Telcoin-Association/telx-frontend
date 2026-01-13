import React from "react";
import ReturnAsset from "../common/ReturnAsset";

//types
import { PoolGeneralized as PoolGeneralizedProps } from "@/types/PoolGeneralized";

interface GeneralizedPoolsFullProps {
  contracts: {
    data: PoolGeneralizedProps[];
  };
}

export default function GeneralizedPoolsFull(props: GeneralizedPoolsFullProps) {
  const { contracts } = props;
  const { data } = contracts;

  return (
    <div className="generalized-pools-full max-w-xl xl:max-w-3xl mx-auto">
      <div className="flex flex-row justify-between text-primary my-4">
        <h4>Pool</h4>
        <h4>Add Liquidity</h4>
      </div>
      {data.map((contract, i) => {
        const { pool_address, link_add_liquidity, pool_assets } = contract.attributes;
        const { data: assetsData } = pool_assets;

        return (
          <div className="flex flex-row justify-between py-4 border-t-[0.7px] border-gray-400 items-center" key={i}>
            <div>
              <div className="font-bold text-gray-1100 flex flex-row space-x-1 pr-2">
                {assetsData?.map((asset, i) => {
                  const assetName = asset.attributes.name;
                  if (typeof assetName === "string") {
                    return <ReturnAsset ticker={assetName.split(" ")[0]} key={i} size={24} />;
                  } else {
                    console.error("Invalid asset name:", asset);
                    return null;
                  }
                })}
              </div>
            </div>
            <div>
              {" "}
              <div className="font-bold text-gray-1100 flex flex-row space-x-1 pr-2">
                {pool_assets?.data?.map((asset, i) => {
                  const assetName = asset.attributes.name;
                  if (typeof assetName === "string") {
                    const [ticker, weight] = assetName.split(" ");
                    return (
                      <div
                        key={i}
                        className="bg-white-100 rounded-md text-sm font-normal text-primary flex flex-row space-x-1 space-y-1 px-1 py-[0.15rem] m-1"
                      >
                        {ticker} {weight}%
                      </div>
                    );
                  } else {
                    console.error("Invalid asset name:", asset);
                    return null;
                  }
                })}
              </div>
            </div>
            <div>
              {pool_address ? (
                <a href={link_add_liquidity} target="_blank" rel="noreferrer" className="text-blue-700 hover:text-burple-700 cursor-pointer">
                  {pool_address.substring(0, 4) + "..." + pool_address.substring(pool_address.length - 3)}
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
