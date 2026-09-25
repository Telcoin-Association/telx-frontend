import React from "react";
import { useGetMarketRateQuery } from "../../redux/slices/marketRateSlice";
import { numberToDecimalFixed } from "../../helpers/returnNumber";
import { useMemo } from "react";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import ReturnAsset from "../common/ReturnAsset";
import BigNumber from "bignumber.js";

const ContractReward = ({
  amount,
  ticker,
  includeConversion,
  amountToFixed = 0,
  flex = false,
  legacy = false,
}: {
  amount: number;
  ticker: string;
  includeConversion?: boolean;
  amountToFixed?: number;
  flex?: boolean;
  // legacy TEL shows the greyed-out logo
  legacy?: boolean;
}) => {

  const { data, isLoading } = useGetMarketRateQuery() as {
    data: any;
    isLoading: boolean;
  };

  const rewardInUSD = useMemo(() => {
    let result;
    if (data && amount) {
      const value = new BigNumber(amount).multipliedBy(
        data?.[ticker]?.USD || 0
      );
      if (value) {
        result = formatNumberToCurrencyString(value.toNumber());
      }
    }
    return result;
  }, [amount, data, ticker]);

  return (
    <div>
      {
        flex ?
          <div className="flex items-end justify-between gap-2 w-full">
            <div className="flex items-center w-full gap-1">
              <ReturnAsset ticker={ticker} size={24} legacy={legacy} />
              <p
                className={[
                  "font- bold text-sm text-white",
                ].join(" ")}
              >
                {numberToDecimalFixed(amount, amountToFixed)}
              </p>
            </div>
            <div className="flex items-end w-full text-end justify-end">
              {includeConversion ? (
                isLoading ? (
                  <LoadingAnimation size={24} />
                ) : (
                  <p
                    className={[
                      " text-xs font-normal text-primary",
                    ].join(" ")}
                  >
                    {rewardInUSD}
                  </p>
                )
              ) : undefined}
            </div>
          </div>
          :
          <div className="flex items-center justify-end gap-2 w-full">
            <div className="flex flex-col items-end">
              <p
                className={[
                  "font- bold text-sm text-white",
                ].join(" ")}
              >
                {numberToDecimalFixed(amount, amountToFixed)}
              </p>
              {includeConversion ? (
                isLoading ? (
                  <LoadingAnimation size={24} />
                ) : (
                  <p
                    className={[
                      "text-end text-xs font-normal text-primary",
                    ].join(" ")}
                  >
                    {rewardInUSD}
                  </p>
                )
              ) : undefined}
            </div>
            <ReturnAsset ticker={ticker} size={24} legacy={legacy} />
          </div>
      }
    </div>
  );
};

export default ContractReward;
