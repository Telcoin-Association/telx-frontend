import React from "react";
import Link from "next/link";
import WeightedAsset from "./WeightedAsset";
import ReturnLogo from "./ReturnLogo";
import { contractsWithoutStaking } from "../contract/ContractSectionStake";
import ReturnAsset from "./ReturnAsset";

export interface PoolIdentityProps {
  contractData: {
    assets: {
      ticker: string;
      weight: number;
    }[];
    poolContractAddress?: string;
    stakeContractAddress?: string;
    protocol: string;
    name?: string;
  };
  contractLink?: boolean;
  slug?: string;
  displayProtocol?: boolean;
  displayPoolAddress?: boolean;
  displayStakeAddress?: boolean;
}

const PoolIdentity = (props: PoolIdentityProps) => {
  const { contractData, contractLink, slug, displayProtocol, displayPoolAddress, displayStakeAddress } = props;
  const { assets, poolContractAddress, stakeContractAddress, protocol, name = null } = contractData;

  return (
    <div className="card-pool-identity">
      <div className="flex flex-row items-center space-x-3">
        <div className="pool-illustration space-y-1">
          {assets.map((asset, i) => {
            const { ticker } = asset;
            return <ReturnAsset ticker={ticker} size={20} key={i} />;
          })}
        </div>
        <div className="card-pool-assets">
          <div className="font-bold text-gray-1100">
            {assets.map((asset, i) => {
              const { ticker, weight } = asset;
              return <WeightedAsset ticker={ticker} weight={weight} key={i} />;
            })}
          </div>
        </div>
      </div>
      {displayProtocol && protocol && (
        <div className="pool-identity-brand">
          <ReturnLogo brand={protocol} />
        </div>
      )}
      {(displayPoolAddress || displayStakeAddress) && (
        <div className="my-4 text-primary">
          {displayPoolAddress && poolContractAddress && <p className="break-all mb-3">Pool: {poolContractAddress}</p>}
          {displayStakeAddress && stakeContractAddress && name && !contractsWithoutStaking.includes(name) && (
            <p className="break-all">Stake: {stakeContractAddress}</p>
          )}
          {contractLink && slug && <Link href={`/${slug}/pool/${poolContractAddress}`}>View Contract</Link>}
        </div>
      )}
    </div>
  );
};

export default PoolIdentity;
