import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import LoadingAnimation from "./LoadingAnimationCircle";
import {
  isMerklUniswapPool,
  MERKL_EUSD_TEL_POOLID,
  MERKL_ETH_TEL_POOLID,
  MERKL_POLYGON_EUSD_EMXN_POOLID,
  MERKL_POLYGON_WETH_TEL_POOLID,
} from "@/lib/contracts";
import { positionsChainFor, positionsUrl, type ChainPositions, type Position } from "@/lib/positions";
import { orderPoolAssets } from "@/lib/positionView";
import { usePositionTransferWatch } from "@/hooks/usePositionTransferWatch";
import { usePositionActions } from "@/hooks/usePositionActions";
import { useGetMarketRateQuery } from "@/redux/slices/marketRateSlice";
import { CustomConnectButton } from "../layout/CustomConnectButton";
import PositionsList, { EmptyState } from "./PositionsList";
import { ADD_LIQUIDITY_HASH, onPositionAdded, openAddLiquidity } from "@/lib/poolPageEvents";

const visibleIds = [
  "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7",
  "0x29f94ec9b66df7fe4068e2d7e9bf0147b49afcdc7cd3283dff03088b8026169f",
  "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b",
  "0xb6d004fca4f9a34197862176485c45ceab7117c86f07422d1fe3d9cfd6e9d1da",
  MERKL_ETH_TEL_POOLID,
  MERKL_EUSD_TEL_POOLID,
  MERKL_POLYGON_WETH_TEL_POOLID,
  MERKL_POLYGON_EUSD_EMXN_POOLID,
];

/**
 * The connected wallet's Uniswap v4 positions in one pool, as a filtered list where each row carries its
 * own Subscribe or Unsubscribe action (see usePositionActions).
 */
export default function UserPositions(props: any) {
  const { selectedPool, currentPoolAddress } = props;
  const { address } = useAccount();
  const [userPositions, setUserPositions] = useState<Position[]>([]);
  const [isFetchingPositions, setIsFetchingPositions] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const assets = useMemo(() => orderPoolAssets(selectedPool?.assets), [selectedPool?.assets]);
  // The pool data refresh replaces `selectedPool` with an equal new object every few minutes, so the
  // positions load keys on the fields it reads rather than the object.
  const blockchain: string | undefined = selectedPool?.blockchain;
  const hasPool = Boolean(selectedPool);
  const areaRef = useRef<HTMLDivElement>(null);
  const { data: rates } = useGetMarketRateQuery();

  // Only the latest request may update the list, so a slow response for an earlier account or pool is ignored.
  const latestRequest = useRef(0);

  // Rows keep their outcome across a background refresh; a full reload clears them.
  const clearResultsRef = useRef<() => void>(() => undefined);

  // `minBlock` asks for data read at or after that block, e.g. the block of a confirmed transaction or of a
  // transfer seen in the feed. A background refresh keeps the list and the row results on screen while it
  // loads and keeps the current list if it fails.
  const fetchUserPositions = useCallback(
    async (options: { minBlock?: number; background?: boolean } = {}) => {
      if (!hasPool || !address) {
        setUserPositions([]);
        return;
      }

      const request = ++latestRequest.current;
      if (!options.background) {
        setIsFetchingPositions(true);
        setLoadFailed(false);
        clearResultsRef.current();
      }

      try {
        const res = await fetch(positionsUrl(positionsChainFor(blockchain), address, options.minBlock));
        if (!res.ok) throw new Error("Failed to fetch positions");

        const data: ChainPositions = await res.json();
        if (request !== latestRequest.current) return;
        setUserPositions(data.pools?.[String(currentPoolAddress).toLowerCase()]?.positions || []);
        setLoadFailed(false);
      } catch (err) {
        console.error(err);
        if (request === latestRequest.current && !options.background) {
          setUserPositions([]);
          setLoadFailed(true);
        }
      } finally {
        if (request === latestRequest.current) setIsFetchingPositions(false);
      }
    },
    [address, blockchain, hasPool, currentPoolAddress],
  );

  const { pending, results, subscribe, unsubscribe, clearResults, subscribeNeedsInRange } = usePositionActions({
    blockchain: selectedPool?.blockchain,
    poolId: currentPoolAddress,
    onConfirmed: blockNumber => fetchUserPositions({ minBlock: blockNumber, background: true }),
  });
  clearResultsRef.current = clearResults;

  useEffect(() => {
    if (address) fetchUserPositions();
  }, [address, fetchUserPositions]);

  // A position added from the Add liquidity tab in the chart card.
  useEffect(() => onPositionAdded(blockNumber => fetchUserPositions({ minBlock: blockNumber, background: true })), [fetchUserPositions]);

  // A new or transferred position in this wallet shows up within about a block, without a reload.
  usePositionTransferWatch({
    owner: address,
    chains: [positionsChainFor(selectedPool?.blockchain)],
    enabled: Boolean(selectedPool && visibleIds.includes(currentPoolAddress)),
    onTransfer: (_chain, blockNumber) => fetchUserPositions({ minBlock: blockNumber, background: true }),
  });

  if (!address) {
    return (
      <div className="mb-4">
        <EmptyState>
          <p>Connect your wallet to see your positions in this pool.</p>
          <CustomConnectButton />
        </EmptyState>
      </div>
    );
  }

  if (!visibleIds.includes(currentPoolAddress)) return null;

  return (
    <div ref={areaRef} tabIndex={-1} data-testid="positions-area" className="mb-4 flex flex-col gap-3 outline-none">
      {isFetchingPositions ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-black/20 p-4 text-center text-white">
          Loading your positions... <LoadingAnimation size={24} />
        </div>
      ) : loadFailed ? (
        <EmptyState>
          <p>Your positions could not be loaded.</p>
          <button
            type="button"
            onClick={() => {
              // The button is replaced by the loader, so focus stays on the positions area instead.
              areaRef.current?.focus();
              fetchUserPositions();
            }}
            className="w-fit rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white duration-200 hover:scale-105"
          >
            Try again
          </button>
        </EmptyState>
      ) : (
        <PositionsList
          positions={userPositions}
          assets={assets}
          rates={rates}
          pending={pending}
          results={results}
          onSubscribe={subscribe}
          onUnsubscribe={unsubscribe}
          addLiquidityLink={selectedPool?.addLiquidityLink}
          subscribeNeedsInRange={subscribeNeedsInRange}
          chain={positionsChainFor(blockchain)}
        />
      )}
      <p className="text-sm text-primary">Subscribe a position to earn liquidity mining rewards on it; unsubscribe it to stop.</p>
      {isMerklUniswapPool(currentPoolAddress) && (
        <a
          href={ADD_LIQUIDITY_HASH}
          onClick={openAddLiquidity}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ocean-gradient px-4 py-3 text-base font-bold text-white shadow-lg shadow-[#5533ff55] duration-200 hover:scale-[1.01]"
        >
          <span aria-hidden="true" className="text-xl leading-none">+</span>
          Add liquidity and earn TELx rewards
        </a>
      )}
    </div>
  );
}
