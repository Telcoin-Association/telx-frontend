"use client";

import React, { useEffect, useMemo, useState } from "react";
import BigNumber from "bignumber.js";
import {
  userContractsSelector,
  deprecatedPoolsListSelector,
} from "../../redux/slices/contractsSlice";
import { useAppSelector } from "@/redux/hooks";
import { useGetMarketRateQuery } from "../../redux/slices/marketRateSlice";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import { Reward } from "../../web3/getContracts/quickswap/getStakeInfo";
import Button from "../common/Button";
import WalletItemRewardItem from "./WalletItemRewardItem";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import { useSkrimContext } from "@/components/providers/SkrimProvider";
import WalletLabelValue from "./WalletLabelValue";

// types
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { useRouter } from "next/navigation";
export type RewardTicker = "TEL" | "DQUICK" | "DFX";

export default function WalletItemRewards() {
  const [totalValueUSD, setTotalValueUSD] = useState<string>("N/A");
  const [isLoadingTotal, setIsLoadingTotal] = useState<boolean>(true);
  const userContracts = useAppSelector(userContractsSelector);
  const { data = null } = useGetMarketRateQuery() as {
    data: any;
    isLoading: boolean;
  };

  const { clear } = useSkrimContext();
  const router = useRouter();

  const rewards = useMemo(() => {
    const result: any = {
      TEL: null,
      DQUICK: null,
      DFX: null,
    };
    Object.values(userContracts).forEach((contract) => {
      if (contract.rewards) {
        contract.rewards.forEach((reward: Reward) => {
          if (new BigNumber(reward.unclaimed).isGreaterThan(0)) {
            const key = reward.ticker.toUpperCase();
            if (!result[key]) {
              result[key] = reward.unclaimed;
            } else {
              result[key] = new BigNumber(result[key])
                .plus(reward.unclaimed)
                .toFixed();
            }
          }
        });
      }
    });
    return result;
  }, [userContracts]);

  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);

  const userArchivedContracts = useMemo(() => {
    const contracts: { [key: string]: (typeof archivePoolsList)[string] } = {};
    Object.keys(archivePoolsList).forEach((key) => {
      const pool = archivePoolsList[key];
      if (
        pool.user.stakedLPT &&
        parseFloat(pool.user.stakedLPT.toString()) > 0
      ) {
        contracts[key] = {
          ...pool,
        };
      }
    });
    return contracts;
  }, [archivePoolsList]);

  const archiveRewards = useMemo(() => {
    const result: any = {
      TEL: 0,
      DQUICK: null,
      DFX: null,
    };
    Object.values(
      userArchivedContracts as { [key: string]: ProtocolsContractData }
    ).forEach((contract) => {
      if (contract.rewards) {
        contract.rewards.forEach((reward: Reward) => {
          if (new BigNumber(reward.unclaimed).isGreaterThan(0)) {
            const key = reward.ticker.toUpperCase();
            if (!result[key]) {
              result[key] = reward.unclaimed;
            } else {
              result[key] = new BigNumber(result[key])
                .plus(reward.unclaimed)
                .toFixed();
            }
          }
        });
      }
    });
    return result;
  }, [userArchivedContracts]);

  useEffect(() => {
    // Reset loading state when inputs change
    setIsLoadingTotal(true);

    // Guard clause: wait until data is available
    if (!rewards || !data || Object.keys(rewards).length === 0 || Object.keys(data).length === 0) {
      return;
    }

    let total = new BigNumber(0);

    Object.keys(rewards).forEach((ticker: string) => {
      const unclaimed = rewards[ticker] || null;
      if (unclaimed && data?.[ticker]?.USD) {
        total = new BigNumber(unclaimed)
          .multipliedBy(data[ticker].USD)
          .plus(total);
      }
    });

    const result = formatNumberToCurrencyString(total.toNumber());

    setTotalValueUSD(result);
    if (data !== null) {
      setIsLoadingTotal(false);
    }
  }, [data, rewards]);

  return (
    <div className="rounded-xl w-full">
      <WalletLabelValue
        label="Unclaimed Rewards"
        value={isLoadingTotal ? <LoadingAnimation size={20} /> : totalValueUSD}
        border={true}
      />
      <div className="flex justify-between gap-2 py-5 items-center">
        <p className="text-primary text-sm">
          Active Stake
          <br />
          Rewards
        </p>
        <div className="flex flex-col gap-2 items-end">
          {
            (data !== null) ?
              <>
                {Object.keys(rewards).map((ticker: string) => {
                  const unclaimed = new BigNumber(rewards[ticker] || 0);
                  if (unclaimed.isGreaterThan(0) || ticker === "TEL") {
                    return (
                      <WalletItemRewardItem
                        key={ticker}
                        data={data}
                        ticker={ticker}
                        unclaimed={unclaimed}
                      />
                    );
                  }
                  return;
                })}
              </>
              :
              <LoadingAnimation size={20} />
          }

        </div>
      </div>
      {Object.keys(archiveRewards).some((ticker) =>
        new BigNumber(archiveRewards[ticker] || 0).isGreaterThan(0)
      ) && (
          <div className="flex justify-between gap-2 py-5 items-center border-t border-white-100">
            <p className="text-primary text-sm">
              Archived Stake
              <br />
              Rewards
            </p>
            {Object.keys(archiveRewards).map((ticker: string) => {
              const unclaimed = new BigNumber(archiveRewards[ticker] || 0);
              if (unclaimed.isGreaterThan(0)) {
                return (
                  <WalletItemRewardItem
                    key={ticker}
                    data={data}
                    ticker={ticker}
                    unclaimed={unclaimed}
                  />
                );
              }
              return null;
            })}
          </div>
        )}
      <div className="flex flex-row gap-2 mt-3 mx-auto justify-start">
        <Button
          onClick={() => {
            clear();
            router.push("/rewards");
          }}
          external={false}
          linkText="Rewards"
          linkUrl="/rewards"
          type="small"
          className="text-xs px-5 py-1.25"
        />
      </div>
    </div>
  );
}
