import React, { useCallback, useRef } from "react";
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
import MerklClaimCard from "@/merkl/MerklClaimCard";
import { fetchMerklRewards } from "@/merkl/merklService";
import {
  MERKL_BASE_CHAIN_ID,
  MERKL_ETHEREUM_CHAIN_ID,
  MERKL_POLYGON_CHAIN_ID,
  TEL_DECIMALS,
} from "@/merkl/merklConstants";
import { formatMerklTokenAmount } from "@/merkl/merklUtils";
import { ChevronDown, ChevronUp } from "@transferwise/icons";
import { positionsChainFor, positionsUrl, type ChainPositions, type PoolPositions } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { usePositionTransferWatch } from "@/hooks/usePositionTransferWatch";

interface ProductRewardsMainProps {
  defaultRewards: any;
  notices?: NoticeProps[] | [];
}

// The rewards route sends each chain's amount as a decimal string, or null when that chain's read failed.
const claimableOrNull = (value: unknown): number | null => (value == null || Number.isNaN(Number(value)) ? null : Number(value));

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
  // The connected wallet's positions per chain, keyed by lowercase pool id. A chain whose request failed has no entry.
  const [chainPositions, setChainPositions] = useState<Partial<Record<RpcChain, Record<string, PoolPositions>>>>({});
  // Unclaimed Uniswap rewards per chain; null when that chain's read failed and the amount is unknown.
  const [uniswapBaseRewards, setUniswapBaseRewards] = useState<number | null>(0);
  const [uniswapPolygonRewards, setUniswapPolygonRewards] = useState<number | null>(0);
  const [uniswapEthereumRewards, setUniswapEthereumRewards] = useState<number | null>(0);
  const [merklTelRewards, setMerklTelRewards] = useState<number>(0);
  const [otherCollapse, setOtherCollapse] = useState(true);
  const [uniswapCollapse, setUniswapCollapse] = useState(true);

  const { data = null } = useGetMarketRateQuery() as {
    data: any;
    isLoading: boolean;
  };
  const { address } = useAccount();
  const addressRef = useRef(address);
  addressRef.current = address;

  // Uniswap pools with registry decimals, and the chains they are on. Changing the key only when the set of
  // chains changes keeps a new pool list on the same chains from refetching.
  const uniswapPools = useMemo(
    () =>
      Array.isArray(userUniswapContracts)
        ? userUniswapContracts.filter((pool) => pool.decimals?.amount0Decimals && pool.decimals?.amount1Decimals)
        : [],
    [userUniswapContracts]
  );
  const uniswapChainsKey = [...new Set(uniswapPools.map((pool) => positionsChainFor(pool.blockchain)))].sort().join(",");
  const uniswapChains = useMemo(() => (uniswapChainsKey ? (uniswapChainsKey.split(",") as RpcChain[]) : []), [uniswapChainsKey]);

  const uniswapContractData = useMemo(
    () =>
      uniswapPools.flatMap((pool) => {
        const positions = chainPositions[positionsChainFor(pool.blockchain)]?.[String(pool.poolContractAddress).toLowerCase()]?.positions;
        return positions && positions.length > 0 ? [{ ...pool, positions }] : [];
      }),
    [uniswapPools, chainPositions]
  );

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

  const merklClaimableAsTel = useCallback((result: Awaited<ReturnType<typeof fetchMerklRewards>>) => {
    if (result.isEmpty) return 0;
    const decimals = result.summary.rewards[0]?.tokenDecimals ?? TEL_DECIMALS;
    return parseFloat(
      formatMerklTokenAmount(result.summary.totalClaimable, decimals)
    ) || 0;
  }, []);

  const fetchMerklTelRewards = useCallback(async (options?: { reloadChainId?: number }) => {
    if (!address) {
      setMerklTelRewards(0);
      return;
    }
    try {
      const [ethereumResult, baseResult, polygonResult] = await Promise.all([
        fetchMerklRewards(address, MERKL_ETHEREUM_CHAIN_ID, options),
        fetchMerklRewards(address, MERKL_BASE_CHAIN_ID, options),
        fetchMerklRewards(address, MERKL_POLYGON_CHAIN_ID, options),
      ]);
      setMerklTelRewards(
        merklClaimableAsTel(ethereumResult) +
          merklClaimableAsTel(baseResult) +
          merklClaimableAsTel(polygonResult)
      );
    } catch (err) {
      console.error("Error fetching Merkl rewards for portfolio total:", err);
    }
  }, [address, merklClaimableAsTel]);

  const fetchUserUniswapRewards = useCallback(async () => {
    setIsUniswapRewardsLoading(true);
    if (!address) {
      setUniswapBaseRewards(0);
      setUniswapPolygonRewards(0);
      setUniswapEthereumRewards(0);
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
      setUniswapBaseRewards(claimableOrNull(data?.claimableAmount?.base));
      setUniswapPolygonRewards(claimableOrNull(data?.claimableAmount?.polygon));
      setUniswapEthereumRewards(claimableOrNull(data?.claimableAmount?.ethereum));
      // Filter only subscribed positions
      setIsUniswapRewardsLoading(false);
      return (data)
    } catch (err) {
      console.error("Error fetching pool positions:", err);
      setUniswapBaseRewards(null);
      setUniswapPolygonRewards(null);
      setUniswapEthereumRewards(null);
      setIsUniswapRewardsLoading(false);
      return null;
    }
    finally {
      setIsUniswapRewardsLoading(false);
    }
  }, [address]);

  // One positions request per chain covers every pool on it. `minBlock` asks for data read at or after
  // that block. A response for an account that is no longer connected is ignored.
  const fetchChainPositions = useCallback(async (chain: RpcChain, minBlock?: number) => {
    if (!address) return;
    try {
      const res = await fetch(positionsUrl(chain, address, minBlock));
      if (!res.ok) throw new Error("Failed to fetch positions");
      const data: ChainPositions = await res.json();
      if (addressRef.current?.toLowerCase() !== data.owner) return;
      setChainPositions((current) => ({ ...current, [chain]: data.pools }));
    } catch (err) {
      console.error("Error fetching pool positions:", err);
    }
  }, [address]);

  const fetchUserPools = useCallback(async () => {
    setIsLoading(true);
    setChainPositions({});
    if (!address) {
      setIsLoading(false);
      return;
    }
    try {
      await Promise.all(uniswapChains.map((chain) => fetchChainPositions(chain)));
    } finally {
      setIsLoading(false);
    }
  }, [address, uniswapChains, fetchChainPositions]);

  useEffect(() => {
    if (isTransacting && !wasTransacting) {
      setWasTransacting(true);
    }
  }, [isTransacting, wasTransacting]);

  useEffect(() => {
    fetchUserPools();
  }, [fetchUserPools]);

  // A new or transferred position in this wallet shows up within about a block, without a reload.
  usePositionTransferWatch({
    owner: address,
    chains: uniswapChains,
    onTransfer: (chain, blockNumber) => fetchChainPositions(chain, blockNumber),
  });

  useEffect(() => {
    fetchUserUniswapRewards();
  }, [fetchUserUniswapRewards, address]);

  useEffect(() => {
    fetchMerklTelRewards();
  }, [fetchMerklTelRewards]);

  return (
    <div className="flex min-h-screen flex-col px-4 py-20">
      {address ? <> {contractsLoading ? (
        <LoadingWrapper />
      ) : (
        <>
          {rewardsContractData.length > 0 && (
            <StatsSection
              address={`${address}`}
              rewards={rewards}
              data={data}
              uniswapTelRewards={(uniswapBaseRewards ?? 0) + (uniswapPolygonRewards ?? 0) + (uniswapEthereumRewards ?? 0)}
              merklTelRewards={merklTelRewards}
            />
          )}
          <div className="mb-4">
            <h3 className="pb-4 text-[20px] text-white-100">
              Uniswap Claim Rewards (new pools)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MerklClaimCard
                userAddress={address}
                blockchain="ethereum"
                onClaimSuccess={() =>
                  fetchMerklTelRewards({
                    reloadChainId: MERKL_ETHEREUM_CHAIN_ID,
                  })
                }
              />
              <MerklClaimCard
                userAddress={address}
                blockchain="base"
                onClaimSuccess={() =>
                  fetchMerklTelRewards({ reloadChainId: MERKL_BASE_CHAIN_ID })
                }
              />
              <MerklClaimCard
                userAddress={address}
                blockchain="polygon"
                onClaimSuccess={() =>
                  fetchMerklTelRewards({
                    reloadChainId: MERKL_POLYGON_CHAIN_ID,
                  })
                }
              />
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 mt-2">
            <h3 className="pb-4 text-[20px] text-white-100">
              Uniswap Claimable Rewards (old pools)
            </h3>

            {isUniswapRewardsLoading ?
              <LoadingAnimation
                theme="extra-light"
                message="Loading uniswap rewards"
              /> :
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <UnclaimedUniswapRewardsCard
                  uniswapRewards={uniswapEthereumRewards}
                  selectedWalletAddress={address}
                  blockchain="ethereum"
                  fetchUserUniswapRewards={fetchUserUniswapRewards}
                />
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
                Balancer Claimable Rewards (deprecated)
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
                  Your LPT stakes (deprecated)
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
