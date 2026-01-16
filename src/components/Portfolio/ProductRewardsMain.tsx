import React, { useCallback } from "react";
import { useState, useEffect, useMemo } from "react";
import CardRewards from "./CardRewards";
import NoticeBig from "../common/NoticeBig";
import { useAppSelector } from "@/redux/hooks";
import { web3Selector } from "../../redux/slices/web3Slice";
import {
  contractsLoadingSelector,
  userContractsSelector,
  deprecatedPoolsListSelector,
  userUniswapContractsSelector,
} from "../../redux/slices/contractsSlice";
import LoadingWrapper from "../common/LoadingWrapper";
import { ZERO_TOKEN_BALANCE } from "@/lib/constants";
import { useAccount } from "wagmi";
import BigNumber from "bignumber.js";
import { Notice as NoticeProps } from "@/types/Notice";
import UnclaimedRewardsCard from "./UnclaimedRewardsCard";
import { useGetMarketRateQuery } from "@/redux/slices/marketRateSlice";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import StatsSection from "./StatsSection";
import { UniswapContractData } from "@/web3/getContracts/uniswapv4/getSingleContractData";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import UnclaimedUniswapRewardsCard from "./UnclaimedUniswapRewardsCard";
import { ChevronDown, ChevronUp } from "@transferwise/icons";

interface ProductRewardsMainProps {
  defaultRewards: any;
  notices?: NoticeProps[] | [];
}

const ProductRewardsMain = (props: ProductRewardsMainProps) => {
  const { defaultRewards, notices = [] } = props;
  const [wasTransacting, setWasTransacting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUniswapRewardsLoading, setIsUniswapRewardsLoading] = useState(true);
  const contractsLoading = useAppSelector(contractsLoadingSelector);
  const { isTransacting } = useAppSelector(web3Selector);
  const userContracts = useAppSelector(userContractsSelector);
  const userUniswapContracts = useAppSelector(userUniswapContractsSelector) as unknown as UniswapContractData[];
  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);
  const [uniswapContractData, setUniswapContractData] = useState<any[]>([]);
  const [uniswapBaseRewards, setUniswapBaseRewards] = useState<number>(0);
  const [uniswapPolygonRewards, setUniswapPolygonRewards] = useState<number>(0);
  const [otherCollapse, setOtherCollapse] = useState(true);
  const [uniswapCollapse, setUniswapCollapse] = useState(true);

  const { data = null } = useGetMarketRateQuery() as {
    data: any;
    isLoading: boolean;
  };
  const { address } = useAccount();

  const rewardsContractData = useMemo(() => {
    if (Object.values(userContracts).length > 0) {
      const stakedRewards = Object.values(userContracts).filter(
        (contract: any) =>
          contract?.user?.stakedLPT &&
          Number(contract.user.stakedLPT) > 0 &&
          contract.user.stakedLPT !== ZERO_TOKEN_BALANCE
      );
      const stakedRewardsDeprecated = Object.values(userContracts).filter(
        (contract: any) =>
          contract?.user?.deprecated &&
          Number(contract.user.deprecated.stakedLPT) > 0 &&
          contract.user.deprecated.stakedLPT !== ZERO_TOKEN_BALANCE
      );

      return stakedRewards.concat(stakedRewardsDeprecated);
    }
    return [];
  }, [userContracts]);

  const lptContractData = useMemo(() => {
    if (Object.values(userContracts).length > 0) {
      const stakedRewards = Object.values(userContracts).filter(
        (contract: any) =>
          contract?.user?.stakedLPT &&
          Number(contract.user.stakedLPT) > 0 &&
          contract.user.stakedLPT !== ZERO_TOKEN_BALANCE
      );
      const stakedRewardsDeprecated = Object.values(userContracts).filter(
        (contract: any) =>
          contract?.user?.deprecated &&
          Number(contract.user.deprecated.stakedLPT) > 0 &&
          contract.user.deprecated.stakedLPT !== ZERO_TOKEN_BALANCE
      );
      // archivedUserPools added recently
      const archivedUserPools = Object.values(archivePoolsList || {}).filter(
        (contract) => {
          const stakedLPT = contract?.user?.deprecated?.stakedLPT;
          return Number(stakedLPT) > 0 && stakedLPT !== ZERO_TOKEN_BALANCE;
        }
      );
      const temp = archivedUserPools.concat(stakedRewardsDeprecated)
      return stakedRewards.concat(temp);
    }
    return [];
  }, [userContracts, archivePoolsList]);

  const stakeUndetectedNotice = notices.filter(
    (notice) => notice.attributes.notice_id === "stake-undetected"
  );

  const {
    title: stakeUndetectedTitle,
    description: stakeUndetectedDescription,
  } = stakeUndetectedNotice[0]?.attributes || {};

  const claimableRewards = useMemo(() => {
    return (rewardsContractData || []).map((contractData: any, i: any) => {
      return (
        <UnclaimedRewardsCard
          key={i}
          contractData={contractData}
          selectedWalletAddress={address}
          defaultRewards={defaultRewards}
        />
      );
    });
  }, [rewardsContractData, address, defaultRewards]);

  const activeRewardCards = useMemo(() => {
    return (lptContractData || []).map((contractData: any, i: any) => {
      return (
        <CardRewards
          key={i}
          contractData={contractData}
          selectedWalletAddress={address}
          defaultRewards={defaultRewards}
        />
      );
    });
  }, [lptContractData, address, defaultRewards]);

  const uniswapActiveRewardCards = useMemo(() => {
    return (uniswapContractData || []).map((contractData: any, i: any) => {
      return (
        <CardRewards
          key={i}
          contractData={contractData}
          selectedWalletAddress={address}
          defaultRewards={defaultRewards}
        />
      );
    });

  }, [uniswapContractData, address, defaultRewards]);

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

  const fetchUserUniswapRewards = useCallback(async () => {
    setIsUniswapRewardsLoading(true);
    if (!address) {
      setUniswapBaseRewards(0);
      setUniswapPolygonRewards(0);
      setIsLoading(false);
      return;
    }
    try {
      const baseUrl = "/api/uniswap-user-rewards"

      const res = await fetch(
        `${baseUrl}?userAddress=${address}`
      );

      if (!res.ok) throw new Error("Failed to fetch rewards");
      const data = await res.json();
      setUniswapBaseRewards(data?.claimableAmount?.base ? data?.claimableAmount?.base : 0);
      setUniswapPolygonRewards(data?.claimableAmount?.polygon ? data?.claimableAmount?.polygon : 0);
      // Filter only subscribed positions
      setIsUniswapRewardsLoading(false);
      return (data)
    } catch (err) {
      console.error("Error fetching pool positions:", err);
      setIsUniswapRewardsLoading(false);
      return null;
    }
    finally {
      setIsUniswapRewardsLoading(false);
    }
  }, [address]);

  const fetchUserPools = useCallback(async () => {
    setIsLoading(true);
    if (!address || !userUniswapContracts) {
      setUniswapContractData([]);
      setIsLoading(false);
      return;
    }
    if (Array.isArray(userUniswapContracts))
      try {
        const results = await Promise.all(
          userUniswapContracts?.map(async (selectedPool) => {
            // Add this check to skip invalid pools early
            if (!selectedPool.decimals?.amount0Decimals || !selectedPool.decimals?.amount1Decimals) {
              return null;
            }

            try {
              const baseUrl = selectedPool?.blockchain === "base"
                ? "/api/uniswap-user-positions-base"
                : "/api/uniswap-user-positions-polygon";

              const res = await fetch(
                `${baseUrl}?userAddress=${address}&poolAddress=${selectedPool.poolContractAddress}&amount0Decimals=${selectedPool.decimals.amount0Decimals}&amount1Decimals=${selectedPool.decimals.amount1Decimals}`
              );

              if (!res.ok) throw new Error("Failed to fetch positions");
              const data = await res.json();
              // Filter only subscribed positions
              // const subscribedPositions = data.positions.filter((position: any) => position.isSubscribed);

              return data?.positions?.length > 0
                ? { ...selectedPool, positions: data.positions }
                : null;
            } catch (err) {
              console.error("Error fetching pool positions:", err);
              return null;
            }
          })
        );

        // Filter valid pools
        const validPools = results.filter((pool): pool is NonNullable<typeof pool> => pool !== null);
        setUniswapContractData(validPools);
      } catch (error) {
        console.error("Error in fetchUserPools:", error);
        setUniswapContractData([]);
      } finally {
        setIsLoading(false);
      }
  }, [address, userUniswapContracts]); // Add all dependencies

  useEffect(() => {
    if (isTransacting && !wasTransacting) {
      setWasTransacting(true);
    }
  }, [isTransacting, wasTransacting]);

  useEffect(() => {
    fetchUserPools();
  }, [fetchUserPools]);

  useEffect(() => {
    fetchUserUniswapRewards();
  }, [fetchUserUniswapRewards, address]);

  return (
    <div className="flex min-h-screen flex-col px-4 py-20">
      {address ? <> {contractsLoading ? (
        <LoadingWrapper />
      ) : (
        <>
          {rewardsContractData.length > 0 && (
            <StatsSection address={`${address}`} rewards={rewards} data={data} />
          )}
          <div>
            <h3 className="pb-4 text-[20px] text-white-100">
              Uniswap Claimable Rewards
            </h3>

            {isUniswapRewardsLoading ?
              <LoadingAnimation
                theme="extra-light"
                message="Loading uniswap rewards"
              /> :
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <UnclaimedUniswapRewardsCard
                  uniswapRewards={uniswapBaseRewards}
                  selectedWalletAddress={address}
                  blockchain="base"
                  fetchUserUniswapRewards={fetchUserUniswapRewards}
                />
                <UnclaimedUniswapRewardsCard
                  uniswapRewards={uniswapPolygonRewards}
                  selectedWalletAddress={address}
                  blockchain="polygon"
                  fetchUserUniswapRewards={fetchUserUniswapRewards}
                />
              </div>
            }
          </div>
          {rewardsContractData.length > 0 && (
            <div>
              <h3 className="pb-4 text-[20px] text-white-100">
                Other Claimable Rewards
              </h3>

              <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-4`}>{claimableRewards}</div>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="pb-4 text-[20px] text-white-100">
                Your Active Uniswap Pools
              </h3>
              {uniswapCollapse
                ?
                <button onClick={() => setUniswapCollapse(false)}>
                  <ChevronDown className="cursor-pointer text-white" size={24} />
                </button> :
                <button onClick={() => setUniswapCollapse(true)}>
                  <ChevronUp className="cursor-pointer text-white" size={24} />
                </button>
              }
            </div>
            {isLoading ?
              <LoadingAnimation
                theme="extra-light"
                message="Loading uniswap pools"
              /> :
              <>
                {uniswapActiveRewardCards.length === 0 ?
                  <h3 className="py-4 text-[20px] text-gray-700 text-center">
                    Uniswap positions not found!
                  </h3>
                  :
                  <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-black/20 rounded-2xl mb-4 ${uniswapCollapse ? "hidden" : "block"}`}>{uniswapActiveRewardCards}</div>
                }
              </>
            }
          </div>
          {rewardsContractData.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <h3 className="pb-4 text-[20px] text-white-100">
                  Your LPT stakes
                </h3>
                {otherCollapse
                  ?
                  <button onClick={() => setOtherCollapse(false)}>
                    <ChevronDown className="cursor-pointer text-white" size={24} />
                  </button> :
                  <button onClick={() => setOtherCollapse(true)}>
                    <ChevronUp className="cursor-pointer text-white" size={24} />
                  </button>
                }
              </div>
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-black/20 rounded-2xl ${otherCollapse ? "hidden" : "block"}`}>{activeRewardCards}</div>
            </div>
          )}
        </>
      )}</>
        :
        <div className="m-auto items-center justify-center">
          <NoticeBig
            title={stakeUndetectedTitle ?? ""}
            description={stakeUndetectedDescription ?? ""}
          />
        </div>
      }

    </div>
  );
};

export default ProductRewardsMain;
