import React from 'react'
import ReturnStatus from './ReturnStatus';
import Image from "next/image";

export default function PositionCard(props: any) {
    const { index, image0, image1, ticker0Name, ticker1Name, position } = props;
    return (
        <div
            className={`flex flex-col sm:flex-row shadow ${index % 2 !== 0 ? "bg-black/10" : "bg-black/30"} sm:items-center justify-between gap-4 p-3 rounded-2xl cursor-pointer transition-all !w-full"`}
        >
            <div className="flex items-center gap-4">
                <div className="flex flex-col gap-2">
                    {/* token info + images */}
                    <ReturnStatus status={position.isSubscribed ? "Subscribed" : "Not Subscribed"} />
                    {image0 && (
                        <div className="flex gap-2">
                            <Image
                                src={image0.src ?? image0}
                                alt={ticker0Name}
                                width={18}
                                height={18}
                            />
                            <p className="text-white text-xs">{position.amounts.amount0}</p>
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
                            <p className="text-white text-xs">{position.amounts.amount1}</p>
                        </div>
                    )}
                </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
                <span className="text-white font-mono text-xs text-end">Position ID: {position.tokenId}</span>
                {
                    Number(position.liquidity) > 0 ?
                        <>
                            {position.isSubscribed ? (
                                <div className="flex w-fit gap-4 items-center bg-green-800 py-1 px-3 rounded-full">
                                    <span className="text-white font-mono font-bold text-xs">Subscribed</span>
                                </div>
                            ) : (
                                <div className="flex w-fit gap-4 items-center bg-white py-1 px-3 rounded-full">
                                    <span className="text-black font-mono font-bold text-xs">Not Subscribed</span>
                                </div>
                            )}
                        </>
                        :
                        <div className="flex w-fit gap-4 items-center bg-red-700 py-1 px-3 rounded-full">
                            <span className="text-white font-mono font-bold text-xs">Closed position</span>
                        </div>
                }
            </div>
        </div>
    )
}
