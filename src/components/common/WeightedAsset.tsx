import React from "react";

export interface WeightedAssetProps {
  ticker: string;
  weight: number;
  displayTicker?: boolean;
}

const WeightedAsset = ({ ticker, weight, displayTicker = true }: WeightedAssetProps) => {
  return (
    <div className="flex flex-col items-center">
      <div className="flex bg-gray-250 p-1 font-normal text-xs text-gray-800 border-lg rounded-md">
        {displayTicker && <h4>{ticker}&nbsp;</h4>} {weight}%
      </div>
    </div>
  );
};

export default WeightedAsset;