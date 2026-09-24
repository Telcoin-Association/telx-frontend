/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useEffect, useState } from 'react'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import LoadingAnimation from './LoadingAnimationCircle';
import { coinImages } from '../pool/PoolWeightChip';
import { toast } from 'react-toastify';
import {
  MERKL_EUSD_TEL_POOLID,
  MERKL_ETH_TEL_POOLID,
  MERKL_POLYGON_EUSD_EMXN_POOLID,
  MERKL_POLYGON_WETH_TEL_POOLID,
  getUniswapChainAddresses,
} from '@/lib/contracts';
import PositionInputCard from '../pool/PositionInputCard';

// Minimal ABI for your PositionManager contract (Subscribe/Unsubscribe)
const positionManagerAbi = [
    {
        type: "function",
        name: "subscribe",
        inputs: [{ type: "uint256", name: "tokenId" }, { type: "address", name: "newSubscriber" }, { type: "bytes", name: "data" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "unsubscribe",
        inputs: [{ type: "uint256", name: "tokenId" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
] as const;

export default function UserPositions(props: any) {
    const { selectedPool, currentPoolAddress } = props;
    const [txLoading, setTxLoading] = useState<string | null>(null);
    const { address, chain } = useAccount();
    const [userPositions, setUserPositions] = useState<{ tokenId: string }[]>([]);
    const [userSubscribedPositions, setUserSubscribedPositions] = useState<{ tokenId: string }[]>([]);
    const [userUnSubscribedPositions, setUserUnSubscribedPositions] = useState<{ tokenId: string }[]>([]);
    const [userClosedPositions, setUserClosedPositions] = useState<{ tokenId: string }[]>([]);
    const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
    const [selectedTokenIdIsSubscribed, setSelectedTokenIdIsSubscribed] = useState<boolean>(false);
    const [isFetchingPositions, setIsFetchingPositions] = useState(false);
    const [activeTab, setActiveTab] = useState("subscribed");

    const visibleIds =
        [
            "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7",
            "0x29f94ec9b66df7fe4068e2d7e9bf0147b49afcdc7cd3283dff03088b8026169f",
            "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b",
            "0xb6d004fca4f9a34197862176485c45ceab7117c86f07422d1fe3d9cfd6e9d1da",
            MERKL_ETH_TEL_POOLID,
            MERKL_EUSD_TEL_POOLID,
            MERKL_POLYGON_WETH_TEL_POOLID,
            MERKL_POLYGON_EUSD_EMXN_POOLID,
            // For testing purposes — Ethereum eUSD/TEL pool
            // ETHEREUM_EUSD_TEL_POOLID,
        ];

    const { decimals, assets } = selectedPool;
    const chainAddresses = getUniswapChainAddresses(selectedPool?.blockchain, currentPoolAddress);

    const { data: hash, isPending, writeContractAsync } = useWriteContract();

    // We get the status booleans and data/error objects here...
    const {
        data: txData,
        isSuccess: isTxConfirmed,
        isError: isTxError,
        error: txError,
    } = useWaitForTransactionReceipt({
        hash,
    });

    // --- ...and we react to them in a useEffect ---
    useEffect(() => {
        if (isTxConfirmed) {
            console.log("Transaction successful", txData);
            toast.success("Transaction confirmed successfully!");
            fetchUserPositions();
            setTxLoading(null);
        }

        if (isTxError) {
            console.log("Transaction error", txError);
            toast.error(`Transaction error ${txError}`);
            setTxLoading(null);
        }
    }, [isTxConfirmed, isTxError, txData, txError, setTxLoading]);

    const handleSubscribe = async () => {
        if (!selectedTokenId) return;
        setTxLoading("Subscribing...");

        try {
            await writeContractAsync({
                address: chainAddresses.positionManager as `0x${string}`,
                abi: positionManagerAbi,
                functionName: 'subscribe',
                args: [BigInt(selectedTokenId), chainAddresses.subscriber as `0x${string}`, "0x"],
            });
        } catch (err) {
            console.error("Subscription failed", err);
            setTxLoading(null); // Clear loading on user rejection
        }
    };

    const handleUnsubscribe = async () => {
        if (!selectedTokenId) return;
        setTxLoading("Unsubscribing...");
        try {
            await writeContractAsync({
                address: chainAddresses.positionManager as `0x${string}`,
                abi: positionManagerAbi,
                functionName: 'unsubscribe',
                args: [BigInt(selectedTokenId)],
            });
        } catch (err) {
            console.error("Unsubscription failed", err);
            setTxLoading(null); // Clear loading on user rejection
        }
    };

    const fetchUserPositions = useCallback(async () => {
        // Don't fetch if pool address is missing
        if (!selectedPool) {
            setUserPositions([]);
            return;
        }

        setIsFetchingPositions(true);
        setSelectedTokenId(null); // Reset selection on new fetch
        const { positionsApiPath } = getUniswapChainAddresses(selectedPool?.blockchain, currentPoolAddress);

        try {
            const res = await fetch(
                `${positionsApiPath}?userAddress=${address}&poolAddress=${currentPoolAddress}&amount0Decimals=${decimals?.amount0Decimals}&amount1Decimals=${decimals?.amount1Decimals}`
            );

            if (!res.ok) {
                throw new Error("Failed to fetch positions");
            }

            const data = await res.json();
            setUserPositions(data.positions || []);

        } catch (err) {
            console.error(err);
            setUserPositions([]);
        } finally {
            setIsFetchingPositions(false);
        }
    }, [address, chain, selectedPool, currentPoolAddress, decimals]);

    useEffect(() => {
        if (address)
            fetchUserPositions();
    }, [address, fetchUserPositions]);

    useEffect(() => {
        const subscribed = userPositions?.filter(
            (p: any) => Number(p.liquidity) > 0 && p.isSubscribed
        );
        setUserSubscribedPositions(subscribed || []);

        const notSubscribed = userPositions?.filter(
            (p: any) => Number(p.liquidity) > 0 && !p.isSubscribed
        );
        setUserUnSubscribedPositions(notSubscribed || []);

        const closed = userPositions?.filter(
            (p: any) => Number(p.liquidity) <= 0
        );
        setUserClosedPositions(closed || []);
    }, [userPositions]);

    return (
        <div>
            {address ?

                visibleIds.includes(currentPoolAddress) &&
                <>
                    <div className="mb-4">
                        <div className="">
                            {isFetchingPositions && (
                                <div className="p-4 rounded-2xl bg-black/20 text-white text-center">
                                    Loading your positions...  <LoadingAnimation size={24} />
                                </div>
                            )}
                            {!isFetchingPositions && userPositions.length > 0 && (
                                <>
                                    <div className="flex flex-col sm:flex-row gap-2 justify-between mb-3">
                                        <h3 className="text-white text-lg font-semibold">
                                            Your positions in this pool
                                        </h3>
                                        <div className="grid grid-cols-3 gap-1">
                                            <button
                                                className={`w-full border px-3 border-gray-800/20 text-xs cursor-pointer rounded-full ${activeTab === "subscribed" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} py-2 hover:bg-[#0E0E3E]/50`}
                                                onClick={() => {
                                                    setActiveTab("subscribed");
                                                }}
                                            >
                                                Subscribed <span className="font-bold text-white">({userSubscribedPositions?.length})</span>
                                            </button>
                                            <button
                                                className={`w-full border px-3 border-gray-800/20 text-xs cursor-pointer rounded-full ${activeTab === "unSubscribed" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} py-2 hover:bg-[#0E0E3E]/50`}
                                                onClick={() => {
                                                    setActiveTab("unSubscribed");
                                                }}
                                            >
                                                UnSubscribed <span className="font-bold text-white">({userUnSubscribedPositions?.length})</span>
                                            </button>
                                            <button
                                                className={`w-full border px-3 border-gray-800/20 text-xs cursor-pointer rounded-full ${activeTab === "closed" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} py-2 hover:bg-[#0E0E3E]/50`}
                                                onClick={() => {
                                                    setActiveTab("closed");
                                                }}
                                            >
                                                Closed <span className="font-bold text-white">({userClosedPositions?.length})</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-black/20 shadow-xl">
                                        <fieldset>
                                            <legend className="sr-only">Select a Token ID to subscribe</legend>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {activeTab === "subscribed" ? userSubscribedPositions.map((pos: any) => {
                                                    // ✅ determine ticker + image
                                                    const ticker0Name = assets[0]?.ticker ? assets[0]?.ticker.toLowerCase() : "";
                                                    const ticker1Name = assets[1]?.ticker ? assets[1]?.ticker.toLowerCase() : "";

                                                    const image0 = assets[0]?.ticker ? coinImages[ticker0Name] : "";
                                                    const image1 = assets[1]?.ticker ? coinImages[ticker1Name] : null;

                                                    return (
                                                        <PositionInputCard
                                                            key={pos.tokenId}
                                                            pos={pos}
                                                            selectedTokenId={selectedTokenId}
                                                            image0={image0}
                                                            image1={image1}
                                                            ticker0Name={ticker0Name}
                                                            ticker1Name={ticker1Name}
                                                            setSelectedTokenId={setSelectedTokenId}
                                                            setSelectedTokenIdIsSubscribed={setSelectedTokenIdIsSubscribed}
                                                        />
                                                    );
                                                }) :
                                                    activeTab === "unSubscribed" ? userUnSubscribedPositions.map((pos: any) => {
                                                        // ✅ determine ticker + image
                                                        const ticker0Name = assets[0]?.ticker ? assets[0]?.ticker.toLowerCase() : "";
                                                        const ticker1Name = assets[1]?.ticker ? assets[1]?.ticker.toLowerCase() : "";

                                                        const image0 = assets[0]?.ticker ? coinImages[ticker0Name] : "";
                                                        const image1 = assets[1]?.ticker ? coinImages[ticker1Name] : null;

                                                        return (
                                                            <PositionInputCard
                                                                key={pos.tokenId}
                                                                pos={pos}
                                                                selectedTokenId={selectedTokenId}
                                                                image0={image0}
                                                                image1={image1}
                                                                ticker0Name={ticker0Name}
                                                                ticker1Name={ticker1Name}
                                                                setSelectedTokenId={setSelectedTokenId}
                                                                setSelectedTokenIdIsSubscribed={setSelectedTokenIdIsSubscribed}
                                                            />
                                                        );
                                                    })
                                                        :
                                                        userClosedPositions.map((pos: any) => {
                                                            // ✅ determine ticker + image
                                                            const ticker0Name = assets[0]?.ticker ? assets[0]?.ticker.toLowerCase() : "";
                                                            const ticker1Name = assets[1]?.ticker ? assets[1]?.ticker.toLowerCase() : "";

                                                            const image0 = assets[0]?.ticker ? coinImages[ticker0Name] : "";
                                                            const image1 = assets[1]?.ticker ? coinImages[ticker1Name] : null;

                                                            return (
                                                                <PositionInputCard
                                                                    key={pos.tokenId}
                                                                    pos={pos}
                                                                    selectedTokenId={selectedTokenId}
                                                                    image0={image0}
                                                                    image1={image1}
                                                                    ticker0Name={ticker0Name}
                                                                    ticker1Name={ticker1Name}
                                                                    setSelectedTokenId={setSelectedTokenId}
                                                                    setSelectedTokenIdIsSubscribed={setSelectedTokenIdIsSubscribed}
                                                                />
                                                            );
                                                        })
                                                }
                                            </div>
                                        </fieldset>
                                    </div>
                                </>

                            )}
                            {!isFetchingPositions && userPositions.length === 0 && (
                                <div className="p-4 rounded-2xl bg-black/20 text-white/50 text-center">
                                    You do not have any Uniswap v4 positions in this pool.
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="mb-4 space-y-4">
                        <p className="text-primary text-sm">
                            Select one of your positions above to subscribe or unsubscribe from
                            liquidity mining rewards.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button
                                onClick={handleSubscribe}
                                disabled={!selectedTokenId || !!txLoading || selectedTokenIdIsSubscribed}
                                className="flex-1 px-4 py-3 font-semibold text-white bg-blue-600 rounded-lg shadow-lg hover:bg-blue-700 transition-all disabled:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {txLoading === "Subscribing..." ? "Subscribing..." : "Confirm Subscribe"}
                            </button>
                            <button
                                onClick={handleUnsubscribe}
                                disabled={!selectedTokenId || !!txLoading || !selectedTokenIdIsSubscribed}
                                className="flex-1 px-4 py-3 font-semibold text-white bg-red-600 rounded-lg shadow-lg hover:bg-red-700 transition-all disabled:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {txLoading === "Unsubscribing..." ? "Unsubscribing..." : "Confirm UnSubscribe"}
                            </button>
                        </div>

                        {/* Transaction Status Indicators */}
                        {txLoading && !isPending && !hash && (
                            <div className="text-center text-yellow-400 text-sm">{txLoading} (Please check your wallet)</div>
                        )}
                        {isPending && (
                            <div className="text-center text-blue-400 text-sm">Transaction pending...</div>
                        )}
                        {hash && isTxConfirmed && (
                            <div className="text-center text-green-400 text-sm break-all">
                                Transaction sent! <a href={`${chainAddresses.explorerTxBase}${hash}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">View on {chainAddresses.explorerName}</a>
                            </div>
                        )}
                    </div>
                </>
                :
                <div className="border border-status-inProgress bg-white/5 rounded-2xl p-4 shadow-lg text-center">
                    <h3 className="text-sm text-gray-400 font-semibold">
                        Connect your wallet to see your active positions.
                    </h3>
                </div>
            }
        </div>
    )
}
