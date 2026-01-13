import React from 'react'
import Image from "next/image";
import ReturnStatus from '../common/ReturnStatus';


export default function PositionInputCard(props: any) {
    const { pos, selectedTokenId, image0, image1, ticker0Name, ticker1Name, setSelectedTokenId, setSelectedTokenIdIsSubscribed } = props;
    return (
        <label
            key={pos.tokenId}
            className={`flex shadow border border-gray-700/50 w-full items-center justify-between gap-4 p-3 rounded-lg cursor-pointer transition-all ${selectedTokenId === pos.tokenId ? "bg-blue-900/50" : "hover:bg-white/10"
                }`}
        >
            <div className="flex items-center gap-4">
                <input
                    type="radio"
                    name="tokenId"
                    value={pos.tokenId}
                    checked={selectedTokenId === pos.tokenId}
                    onChange={(e) => {
                        setSelectedTokenId(e.target.value);
                        setSelectedTokenIdIsSubscribed(pos.isSubscribed);
                    }}
                    className="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500 focus:ring-2"
                />
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-2">
                            {/* token info + images */}
                            <ReturnStatus status={pos.isSubscribed ? "Subscribed" : "Not Subscribed"} />
                            {image0 && (
                                <div className="flex gap-2">
                                    <Image
                                        src={image0.src ?? image0}
                                        alt={ticker0Name}
                                        width={18}
                                        height={18}
                                    />
                                    <p className="text-white text-xs">{pos.amounts.amount0}</p>
                                </div>
                            )}
                            {image1 && (
                                <div className="flex gap-2">
                                    <Image
                                        src={image1.src ?? image1}
                                        alt={ticker1Name}
                                        width={18}
                                        height={18}
                                    />
                                    <p className="text-white text-xs">{pos.amounts.amount1}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-white font-mono text-xs text-end">Position ID: {pos.tokenId}</span>
                {
                    Number(pos.liquidity) > 0 ?
                        <>
                            {pos.isSubscribed ? (
                                <div className="flex gap-4 items-center bg-green-800 py-1 px-3 rounded-full">
                                    <span className="text-white font-mono font-bold text-xs">Subscribed</span>
                                </div>
                            ) : (
                                <div className="flex gap-4 items-center bg-white py-1 px-3 rounded-full">
                                    <span className="text-black font-mono font-bold text-xs">Not Subscribed</span>
                                </div>
                            )}
                        </>
                        :
                        <div className="flex gap-4 items-center bg-red-700 py-1 px-3 rounded-full">
                            <span className="text-white font-mono font-bold text-xs">Closed position</span>
                        </div>
                }
            </div>
        </label>
    )
}
