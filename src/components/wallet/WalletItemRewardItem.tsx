import React from "react";
import BigNumber from "bignumber.js";
import { MarketRateData } from "../../redux/slices/marketRateSlice";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import ReturnAsset from "../common/ReturnAsset";

interface WalletItemRewardItemProps {
  data?: MarketRateData;
  ticker: string;
  unclaimed: BigNumber;
}

function formatUnclaimed(unclaimed: BigNumber) {
  return unclaimed.isZero() ? "0" : unclaimed.toFixed(2);
}

export default function WalletItemRewardItem(props: WalletItemRewardItemProps) {
  const { data, ticker, unclaimed } = props;
  const unclaimedUSD = unclaimed.multipliedBy(data?.[ticker]?.USD || 0);
  const formattedUnclaimedUSD = formatNumberToCurrencyString(unclaimedUSD.toNumber());

  return (
    <div className="text-right flex flex-row items-center gap-1" key={ticker}>
      <div className="flex flex-col justify-end text-gray-1100 font-bold">
        {ticker} {formatUnclaimed(unclaimed)}
        <div className="usd-amount text-primary text-xs font-normal">{data?.[ticker]?.USD ? formattedUnclaimedUSD : "N/A"}</div>
      </div>
      <ReturnAsset ticker={ticker.toLowerCase()} size={24} />
    </div>
  );
}
