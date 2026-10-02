import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CardRewards from "./CardRewards";
import { useAppSelector } from "@/redux/hooks";
import {
  contractsLoadingSelector,
  hasFetchedDataSelector,
  userContractsSelector,
  deprecatedPoolsListSelector,
  userUniswapContractsSelector,
} from "../../redux/slices/contractsSlice";
import { hasUserHoldings, hasUserStake } from "@/lib/userHoldings";
import LoadingWrapper from "../common/LoadingWrapper";
import { useAccount } from "wagmi";
import BigNumber from "bignumber.js";
import { Notice as NoticeProps } from "@/types/Notice";
import UnclaimedRewardsCard from "./UnclaimedRewardsCard";
import { useGetMarketRateQuery } from "@/redux/slices/marketRateSlice";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import { UniswapContractData } from "@/web3/getContracts/uniswapv4/getSingleContractData";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import UnclaimedUniswapRewardsCard from "./UnclaimedUniswapRewardsCard";
import MerklClaimCard from "@/merkl/MerklClaimCard";
import { fetchMerklRewards } from "@/merkl/merklService";
import { MERKL_CHAIN_CONFIG, TEL_DECIMALS, type MerklBlockchain } from "@/merkl/merklConstants";
import { formatMerklTokenAmount } from "@/merkl/merklUtils";
import { ChevronDown, ChevronUp } from "@transferwise/icons";
import { positionsChainFor, positionsUrl, type ChainPositions, type PoolPositions } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { usePositionTransferWatch } from "@/hooks/usePositionTransferWatch";
import { chainDisplayName } from "@/lib/poolTitle";
import { amountOrNull, formatTel, sumKnown, summarizePositions } from "@/lib/portfolioSummary";
import { usdRate, withConfirmedSubscriptions, type PoolAsset } from "@/lib/positionView";
import { feesCollectableByChain } from "@/lib/claims/feesRows";
import { isMerklUniswapPool } from "@/lib/contracts";
import { truncateAddress } from "@/helpers/returnNumber";
import { EmptyState } from "../common/PositionsList";
import { CustomConnectButton } from "../layout/CustomConnectButton";
import PortfolioSummary from "./PortfolioSummary";
import LegacyTelUpgradeCard from "./LegacyTelUpgradeCard";
import UsdceConvertCard from "./UsdceConvertCard";
import PortfolioPoolPositions from "./PortfolioPoolPositions";
import ClaimAllDialog from "./ClaimAllDialog";
import { useClaimAll } from "@/hooks/useClaimAll";

interface ProductRewardsMainProps {
  defaultRewards: any;
  notices?: NoticeProps[] | [];
}

// Chains in the order their rewards and positions are listed.
const CHAINS: readonly MerklBlockchain[] = ["ethereum", "base", "polygon"];
// The old pools paid rewards through the Base and Polygon position registries only.
const OLD_POOL_CHAINS = ["base", "polygon"] as const;
type OldPoolChain = (typeof OLD_POOL_CHAINS)[number];

/** One chain's Merkl TEL rewards: claimable now, and earned but not yet in a claimable root. */
type MerklChainRewards = { claimable: number; pending: number };

const LINK_BUTTON = "w-fit rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white duration-200 hover-lift";

/** "Ethereum and Base", "Ethereum, Base and Polygon" */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function merklAmount(amount: string, decimals: number): number {
  return parseFloat(formatMerklTokenAmount(amount, decimals)) || 0;
}

/** A pool's key on this page: its chain and lowercase id. */
const poolKeyOf = (pool: { blockchain?: string; poolContractAddress?: string }) =>
  `${pool.blockchain ?? ""}:${String(pool.poolContractAddress).toLowerCase()}`;

function CollapseToggle({ collapsed, onToggle, label }: { collapsed: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? "Show" : "Hide"} ${label}`}>
      {collapsed ? <ChevronDown className="cursor-pointer text-white" size={24} /> : <ChevronUp className="cursor-pointer text-white" size={24} />}
    </button>
  );
}

/**
 * The Portfolio page, top to bottom:
 * - a summary of position value, claimable and pending TEL, and subscribed positions;
 * - the wallet's Uniswap v4 positions, grouped by pool, with the pool page's filters and row actions;
 * - Merkl rewards, one card per chain that has something to claim or pending;
 * - the deprecated Balancer rewards and LP token stakes, whenever the wallet still has a stake or rewards there;
 * - rewards from the old Uniswap pools, collapsed, and left out when every chain reads zero.
 */
const ProductRewardsMain = (props: ProductRewardsMainProps) => {
  const { defaultRewards } = props;
  const [isLoading, setIsLoading] = useState(true);
  const [isUniswapRewardsLoading, setIsUniswapRewardsLoading] = useState(true);
  const contractsLoading = useAppSelector(contractsLoadingSelector);
  const hasFetchedData = useAppSelector(hasFetchedDataSelector);
  const allUserContracts = useAppSelector(userContractsSelector);
  const userUniswapContracts = useAppSelector(userUniswapContractsSelector) as unknown as UniswapContractData[];
  const allArchivePools = useAppSelector(deprecatedPoolsListSelector);
  // The connected wallet's positions per chain, keyed by lowercase pool id. A chain whose request failed has no entry.
  const [chainPositions, setChainPositions] = useState<Partial<Record<RpcChain, Record<string, PoolPositions>>>>({});
  // Chains whose positions request failed, and chains whose token list came back cut short.
  const [failedPositionChains, setFailedPositionChains] = useState<Partial<Record<RpcChain, boolean>>>({});
  const [truncatedPositionChains, setTruncatedPositionChains] = useState<Partial<Record<RpcChain, boolean>>>({});
  // Unclaimed rewards from the old Uniswap pools per chain; null when that chain's read failed and the amount is unknown.
  const [uniswapBaseRewards, setUniswapBaseRewards] = useState<number | null>(0);
  const [uniswapPolygonRewards, setUniswapPolygonRewards] = useState<number | null>(0);
  // Merkl rewards per chain: undefined while loading, null when that chain's read failed.
  const [merklRewards, setMerklRewards] = useState<Partial<Record<MerklBlockchain, MerklChainRewards | null>>>({});
  const [lptCollapse, setLptCollapse] = useState(false);
  const [oldPoolsCollapse, setOldPoolsCollapse] = useState(true);

  const { data = null } = useGetMarketRateQuery() as {
    data: any;
    isLoading: boolean;
  };
  const { address } = useAccount();
  const addressRef = useRef(address);
  addressRef.current = address;

  // Legacy stakes and rewards read for another wallet (a load for a new account that has not succeeded yet)
  // are never shown under this address.
  const forThisWallet = useCallback(
    (contracts: Record<string, any> | undefined) =>
      Object.fromEntries(
        Object.entries(contracts ?? {}).filter(
          ([, contract]) => !contract?.selectedWalletAddress || contract.selectedWalletAddress.toLowerCase() === address?.toLowerCase()
        )
      ),
    [address]
  );
  const userContracts = useMemo(() => forThisWallet(allUserContracts), [forThisWallet, allUserContracts]);
  const archivePoolsList = useMemo(() => forThisWallet(allArchivePools), [forThisWallet, allArchivePools]);

  // The subscription state rows hold after a confirmed action, per pool, so the summary agrees with the rows.
  const [confirmedByPool, setConfirmedByPool] = useState<Record<string, Record<string, boolean>>>({});
  // Each chain's positions area, focused after its "Try again" so keyboard focus stays where the button was.
  const chainAreas = useRef<Partial<Record<RpcChain, HTMLDivElement | null>>>({});

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

  // The pools where the wallet has positions, in chain order.
  const positionGroups = useMemo(
    () =>
      uniswapPools
        .flatMap((pool) => {
          const positions = chainPositions[positionsChainFor(pool.blockchain)]?.[String(pool.poolContractAddress).toLowerCase()]?.positions;
          return positions && positions.length > 0 ? [{ pool, positions }] : [];
        })
        .sort((a, b) => CHAINS.indexOf(a.pool.blockchain as MerklBlockchain) - CHAINS.indexOf(b.pool.blockchain as MerklBlockchain)),
    [uniswapPools, chainPositions]
  );

  // Deprecated staking pools where the wallet has rewards to claim, one card per pool.
  const rewardsContractData = useMemo(
    () => Object.values(userContracts).filter((contract: any) => contract?.protocol !== "uniswap" && hasUserHoldings(contract)),
    [userContracts]
  );

  // Deprecated staking pools where the wallet still has LP tokens staked, one card per pool.
  const lptContractData = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const contract of [...Object.values(userContracts), ...Object.values(archivePoolsList || {})] as any[]) {
      if (contract?.protocol === "uniswap" || !hasUserStake(contract)) continue;
      const key = `${contract.blockchain ?? ""}:${String(contract.poolContractAddress).toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, contract);
    }
    return [...byKey.values()];
  }, [userContracts, archivePoolsList]);

  // Unclaimed TEL in the deprecated staking contracts. These pools paid legacy TEL.
  const deprecatedTel = useMemo(() => {
    let total = new BigNumber(0);
    Object.values(userContracts).forEach((contract: any) => {
      (contract.rewards ?? []).forEach((reward: Reward) => {
        if (String(reward.ticker).toUpperCase() === "TEL" && new BigNumber(reward.unclaimed).isGreaterThan(0)) {
          total = total.plus(reward.unclaimed);
        }
      });
    });
    return total.toNumber();
  }, [userContracts]);

  const fetchMerklTelRewards = useCallback(async (options?: { reloadChainId?: number }) => {
    if (!address) {
      setMerklRewards({});
      return;
    }
    const chains = options?.reloadChainId
      ? CHAINS.filter((chain) => MERKL_CHAIN_CONFIG[chain].chainId === options.reloadChainId)
      : CHAINS;
    const settled = await Promise.allSettled(chains.map((chain) => fetchMerklRewards(address, MERKL_CHAIN_CONFIG[chain].chainId, options)));
    if (addressRef.current !== address) return;
    setMerklRewards((current) => {
      const next = { ...current };
      settled.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error(`Error fetching Merkl rewards on ${chains[i]}:`, result.reason);
          next[chains[i]] = null;
          return;
        }
        const { summary, isEmpty } = result.value;
        const decimals = summary.rewards[0]?.tokenDecimals ?? TEL_DECIMALS;
        next[chains[i]] = isEmpty
          ? { claimable: 0, pending: 0 }
          : { claimable: merklAmount(summary.totalClaimable, decimals), pending: merklAmount(summary.totalPending, decimals) };
      });
      return next;
    });
  }, [address]);

  const fetchUserUniswapRewards = useCallback(async () => {
    setIsUniswapRewardsLoading(true);
    if (!address) {
      setUniswapBaseRewards(0);
      setUniswapPolygonRewards(0);
      setIsUniswapRewardsLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/uniswap-user-rewards?userAddress=${address}`);
      if (!res.ok) throw new Error("Failed to fetch rewards");
      const data = await res.json();
      setUniswapBaseRewards(amountOrNull(data?.claimableAmount?.base));
      setUniswapPolygonRewards(amountOrNull(data?.claimableAmount?.polygon));
      return data;
    } catch (err) {
      console.error("Error fetching old pool rewards:", err);
      setUniswapBaseRewards(null);
      setUniswapPolygonRewards(null);
      return null;
    } finally {
      setIsUniswapRewardsLoading(false);
    }
  }, [address]);

  // One positions request per chain covers every pool on it. `minBlock` asks for data read at or after
  // that block. A response for an account that is no longer connected is ignored. A failed request marks
  // the chain as failed, so the page offers a retry rather than reading as "no positions".
  const fetchChainPositions = useCallback(async (chain: RpcChain, minBlock?: number) => {
    if (!address) return;
    try {
      const res = await fetch(positionsUrl(chain, address, minBlock));
      if (!res.ok) throw new Error(`Failed to fetch positions (HTTP ${res.status})`);
      const data: ChainPositions = await res.json();
      if (addressRef.current?.toLowerCase() !== data.owner) return;
      setChainPositions((current) => ({ ...current, [chain]: data.pools }));
      setFailedPositionChains((current) => ({ ...current, [chain]: false }));
      setTruncatedPositionChains((current) => ({ ...current, [chain]: Boolean(data.truncated) }));
    } catch (err) {
      console.error(`Error fetching positions on ${chain}:`, err);
      if (addressRef.current !== address) return;
      setFailedPositionChains((current) => ({ ...current, [chain]: true }));
    }
  }, [address]);

  const fetchUserPools = useCallback(async () => {
    setIsLoading(true);
    setChainPositions({});
    setFailedPositionChains({});
    setTruncatedPositionChains({});
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
  }, [fetchUserUniswapRewards]);

  useEffect(() => {
    setMerklRewards({});
    fetchMerklTelRewards();
  }, [fetchMerklTelRewards]);

  // A chain's claim card stays on screen once shown, so claiming its last TEL does not pull the card (and
  // its confirmation state) out from under the user.
  const shownMerklChains = useRef(new Set<MerklBlockchain>());
  useEffect(() => {
    shownMerklChains.current.clear();
  }, [address]);
  const merklChainsToShow = CHAINS.filter((chain) => {
    const rewards = merklRewards[chain];
    const show = rewards === null || (rewards !== undefined && (rewards.claimable > 0 || rewards.pending > 0)) || shownMerklChains.current.has(chain);
    if (show) shownMerklChains.current.add(chain);
    return show;
  });
  const merklLoading = CHAINS.some((chain) => merklRewards[chain] === undefined);

  const oldPoolRewards: Record<OldPoolChain, number | null> = {
    base: uniswapBaseRewards,
    polygon: uniswapPolygonRewards,
  };
  const oldPoolsHaveAnything = OLD_POOL_CHAINS.some((chain) => oldPoolRewards[chain] !== 0);
  const oldPoolsTotal = sumKnown(OLD_POOL_CHAINS.map((chain) => oldPoolRewards[chain]));

  // Summary figures, counting each row as the rows show it.
  const positionsSummary = summarizePositions(
    positionGroups.map(({ pool, positions }) => ({
      assets: pool.assets,
      positions: withConfirmedSubscriptions(positions, confirmedByPool[poolKeyOf(pool)] ?? {}),
    })),
    data ?? undefined
  );
  // A chain whose latest positions read failed. With rows from an earlier read still shown it is "stale";
  // with nothing to show it is left out of the summary.
  const hasRows = (chain: RpcChain) => Boolean(chainPositions[chain]);
  const failedChainNames = uniswapChains.filter((chain) => failedPositionChains[chain] && !hasRows(chain)).map(chainDisplayName);
  const staleChainNames = uniswapChains.filter((chain) => failedPositionChains[chain] && hasRows(chain)).map(chainDisplayName);
  const truncatedChainNames = uniswapChains.filter((chain) => truncatedPositionChains[chain]).map(chainDisplayName);
  const positionsPartialNote =
    [
      failedChainNames.length ? `Excludes positions on ${listNames(failedChainNames)}, which could not be loaded.` : null,
      staleChainNames.length ? `Positions on ${listNames(staleChainNames)} could not be refreshed and may be out of date.` : null,
      truncatedChainNames.length ? `Some positions on ${listNames(truncatedChainNames)} may be missing.` : null,
      positionsSummary.unpriced ? `Excludes ${positionsSummary.unpriced} position${positionsSummary.unpriced === 1 ? "" : "s"} without a price.` : null,
    ]
      .filter(Boolean)
      .join(" ") || null;

  const merklClaimable = sumKnown(CHAINS.map((chain) => (merklRewards[chain] === null ? null : merklRewards[chain]?.claimable ?? 0)));
  const merklPending = sumKnown(CHAINS.map((chain) => (merklRewards[chain] === null ? null : merklRewards[chain]?.pending ?? 0)));
  const legacyClaimable = (oldPoolsTotal.total ?? 0) + deprecatedTel;
  const unreadRewards = [
    ...CHAINS.filter((chain) => merklRewards[chain] === null).map((chain) => `Merkl rewards on ${chainDisplayName(chain)}`),
    ...OLD_POOL_CHAINS.filter((chain) => oldPoolRewards[chain] === null).map((chain) => `old pool rewards on ${chainDisplayName(chain)}`),
  ];
  const claimablePartialNote = unreadRewards.length ? `Excludes ${listNames(unreadRewards)}, which could not be read.` : null;
  const telUsd = usdRate(data, "TEL") ?? null;

  const merklClaimableByChain = useMemo(
    () => Object.fromEntries(CHAINS.map((chain) => [chain, merklRewards[chain]?.claimable ?? null])),
    [merklRewards]
  );
  const oldPoolsClaimableByChain = useMemo(
    () => ({ base: uniswapBaseRewards, polygon: uniswapPolygonRewards }),
    [uniswapBaseRewards, uniswapPolygonRewards]
  );
  // Trading fees waiting in the wallet's TELx (Merkl) pool positions, offered as Claim all's optional fees rows.
  const feesCollectable = useMemo(
    () =>
      feesCollectableByChain(
        positionGroups
          .filter(({ pool }) => isMerklUniswapPool(String(pool.poolContractAddress)))
          .map(({ pool, positions }) => ({
            chain: positionsChainFor(pool.blockchain) as MerklBlockchain,
            poolId: String(pool.poolContractAddress),
            assets: (pool as { assets?: PoolAsset[] }).assets,
            positions,
          })),
        data ?? undefined
      ),
    [positionGroups, data]
  );
  const claimAll = useClaimAll({
    address,
    merklClaimable: merklClaimableByChain,
    oldPoolsClaimable: oldPoolsClaimableByChain,
    feesCollectable,
    telUsd,
    onClaimed: (row) => {
      if (row.kind === "merkl") void fetchMerklTelRewards({ reloadChainId: row.chainId });
      else if (row.kind === "fees") void fetchChainPositions(row.chain);
      else void fetchUserUniswapRewards();
    },
  });
  const claimDisabledReason =
    claimAll.disabledReason === "Nothing to claim yet." && merklPending.total
      ? "Pending rewards become claimable after Merkl's next update."
      : claimAll.disabledReason;
  // $0 only when there is nothing to price: no open positions, and at least one chain's positions loaded.
  // Open positions that could not be priced make the value unknown, not zero.
  const positionsValueUsd =
    positionsSummary.valueUsd ??
    (positionsSummary.open === 0 && (failedChainNames.length < uniswapChains.length || uniswapChains.length === 0) ? 0 : null);

  if (!address) {
    return (
      <div className="flex min-h-screen flex-col px-4 py-20">
        <EmptyState>
          <p className="text-base text-white">Connect your wallet to see your positions and rewards.</p>
          <CustomConnectButton />
        </EmptyState>
      </div>
    );
  }

  // Only the first load blanks the page. A later load, such as the one after a deprecated Balancer claim,
  // keeps everything on screen, so a row action in flight keeps its pending state and outcome.
  if (contractsLoading && !hasFetchedData) {
    return (
      <div className="flex min-h-screen flex-col px-4 py-20">
        <LoadingWrapper />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-8 px-4 py-20">
      <header className="flex flex-col gap-1">
        <h2 className="text-3xl text-white-100">Portfolio</h2>
        <p className="font-mono text-xs text-primary" title={address}>
          {truncateAddress(address)}
        </p>
      </header>

      <PortfolioSummary
        positionsValueUsd={positionsValueUsd}
        positionsPartialNote={positionsPartialNote}
        positionsLoading={isLoading}
        claimableTel={merklClaimable.total}
        legacyClaimableTel={legacyClaimable > 0 ? legacyClaimable : null}
        claimablePartialNote={claimablePartialNote}
        claimableLoading={merklLoading || isUniswapRewardsLoading}
        pendingTel={merklPending.total}
        telUsd={telUsd}
        openPositions={positionsSummary.open}
        subscribedPositions={positionsSummary.subscribed}
        claimAction={{ label: claimAll.label, disabledReason: claimDisabledReason, onClick: () => void claimAll.open() }}
      />

      <ClaimAllDialog claimAll={claimAll} />

      <LegacyTelUpgradeCard legacyClaimableTel={legacyClaimable > 0 ? legacyClaimable : null} />

      <UsdceConvertCard />

      <section aria-labelledby="portfolio-positions-heading" className="flex flex-col gap-4">
        <h3 id="portfolio-positions-heading" className="text-[20px] text-white-100">
          Your positions
        </h3>
        {isLoading ? (
          <LoadingAnimation theme="extra-light" message="Loading your positions" />
        ) : (
          <>
            {[...uniswapChains]
              .sort((a, b) => CHAINS.indexOf(a as MerklBlockchain) - CHAINS.indexOf(b as MerklBlockchain))
              .map((chain) => (
                <div
                  key={chain}
                  ref={(el) => {
                    chainAreas.current[chain] = el;
                  }}
                  tabIndex={-1}
                  data-testid={`positions-${chain}`}
                  className="flex flex-col gap-4 outline-none"
                >
                  {failedPositionChains[chain] && (
                    <EmptyState>
                      <p>
                        {hasRows(chain)
                          ? `Your positions on ${chainDisplayName(chain)} could not be refreshed. Those below may be out of date.`
                          : `Your positions on ${chainDisplayName(chain)} could not be loaded.`}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          // The button goes away once the read succeeds, so focus moves to this chain's area.
                          chainAreas.current[chain]?.focus();
                          fetchChainPositions(chain);
                        }}
                        className={LINK_BUTTON}
                      >
                        Try again
                      </button>
                    </EmptyState>
                  )}
                  {positionGroups
                    .filter(({ pool }) => positionsChainFor(pool.blockchain) === chain)
                    .map(({ pool, positions }) => (
                      <PortfolioPoolPositions
                        key={poolKeyOf(pool)}
                        pool={pool as any}
                        positions={positions}
                        rates={data ?? undefined}
                        onConfirmed={(blockNumber) => fetchChainPositions(positionsChainFor(pool.blockchain), blockNumber)}
                        onConfirmedStatuses={(statuses) =>
                          setConfirmedByPool((current) => ({ ...current, [poolKeyOf(pool)]: statuses }))
                        }
                      />
                    ))}
                </div>
              ))}
            {positionGroups.length === 0 && failedChainNames.length === 0 && (
              <EmptyState>
                <p>You have no Uniswap v4 positions in TELx pools yet.</p>
                <Link href="/pools" className={LINK_BUTTON}>
                  Browse pools
                </Link>
              </EmptyState>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="portfolio-rewards-heading" className="flex flex-col gap-4">
        <h3 id="portfolio-rewards-heading" className="text-[20px] text-white-100">
          Rewards
        </h3>
        {merklChainsToShow.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {merklChainsToShow.map((chain) => (
              <MerklClaimCard
                key={chain}
                userAddress={address}
                blockchain={chain}
                onClaimSuccess={() => fetchMerklTelRewards({ reloadChainId: MERKL_CHAIN_CONFIG[chain].chainId })}
              />
            ))}
          </div>
        ) : merklLoading ? (
          <LoadingAnimation theme="extra-light" message="Loading rewards" />
        ) : (
          <p className="text-sm text-primary">No TELx rewards to claim yet. Subscribed positions earn rewards while a campaign is live.</p>
        )}
      </section>

      {rewardsContractData.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="text-[20px] text-white-100">Balancer Claimable Rewards (deprecated)</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rewardsContractData.map((contractData: any) => (
              <UnclaimedRewardsCard
                key={`${contractData.blockchain}:${contractData.poolContractAddress}`}
                contractData={contractData}
                selectedWalletAddress={address}
                defaultRewards={defaultRewards}
              />
            ))}
          </div>
        </section>
      )}

      {lptContractData.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[20px] text-white-100">Your LPT stakes (deprecated)</h3>
            <CollapseToggle collapsed={lptCollapse} onToggle={() => setLptCollapse(!lptCollapse)} label="LPT stakes" />
          </div>
          <div hidden={lptCollapse} className="grid grid-cols-1 gap-4 rounded-2xl bg-black/20 p-4 md:grid-cols-2">
            {lptContractData.map((contractData: any) => (
              <CardRewards
                key={`${contractData.blockchain}:${contractData.poolContractAddress}`}
                contractData={contractData}
                selectedWalletAddress={address}
                defaultRewards={defaultRewards}
              />
            ))}
          </div>
        </section>
      )}

      {(isUniswapRewardsLoading || oldPoolsHaveAnything) && (
        <section className="flex flex-col gap-4 border-t border-white/10 pt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-[20px] text-white-100">
              Uniswap Claimable Rewards (old pools)
              {!isUniswapRewardsLoading && oldPoolsTotal.total ? (
                <span className="ml-2 text-sm text-primary">{formatTel(oldPoolsTotal.total).replace(" TEL", " legacy TEL")}</span>
              ) : null}
            </h3>
            <CollapseToggle collapsed={oldPoolsCollapse} onToggle={() => setOldPoolsCollapse(!oldPoolsCollapse)} label="old pool rewards" />
          </div>
          {isUniswapRewardsLoading ? (
            <LoadingAnimation theme="extra-light" message="Loading old pool rewards" />
          ) : (
            <div hidden={oldPoolsCollapse} className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {OLD_POOL_CHAINS.filter((chain) => oldPoolRewards[chain] !== 0).map((chain) => (
                <UnclaimedUniswapRewardsCard
                  key={chain}
                  uniswapRewards={oldPoolRewards[chain]}
                  selectedWalletAddress={address}
                  blockchain={chain}
                  fetchUserUniswapRewards={fetchUserUniswapRewards}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default ProductRewardsMain;
