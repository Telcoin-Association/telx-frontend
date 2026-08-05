import React, { useEffect, useMemo, useState } from 'react';
import formatNumberToCurrencyString from '@/helpers/formatNumberToCurrencyString';
import ExternalLinkArrow from "../../../public/icons/ExternalLinkArrow.svg"
import LoadingAnimation from '../common/LoadingAnimationCircle';
import polygon from "../../../public/logos/polygon-logo.png";
import base from "../../../public/logos/base-logo.png";
import telcoin from "../../../public/coins/tel.png";
import BigNumber from "bignumber.js";
import Image from "next/image"
import Link from 'next/link';
import { userContractsSelector } from "../../redux/slices/contractsSlice";
import { ProtocolsContractData } from '@/web3/getContracts/shared';
import { useAppSelector } from '@/redux/hooks';

type StatSection = {
    address: string;
    rewards: any;
    data: any;
    uniswapTelRewards: number;
    merklTelRewards?: number;
}

export default function StatsSection({
    address,
    rewards,
    data,
    uniswapTelRewards,
    merklTelRewards = 0,
}: StatSection) {
    const userActiveContracts = useAppSelector(userContractsSelector);
    const [totalValueUSD, setTotalValueUSD] = useState<string>("N/A");
    const [totalValueTel, setTotalValueTel] = useState<string>("N/A");
    const [isLoadingTotal, setIsLoadingTotal] = useState<boolean>(true);

    const userTotalActiveStakedUSD = useMemo(() => {
        if (userActiveContracts && Object.keys(userActiveContracts).length > 0) {
            let total = new BigNumber(0);
            Object.values(userActiveContracts).map((contract: ProtocolsContractData) => {
                const staked = contract.user.stakedUSD;
                if (staked) {
                    total = new BigNumber(staked).plus(total);
                }
            });
            const result = formatNumberToCurrencyString(total.toNumber());

            return result;
        }

        return "$0.00";
    }, [userActiveContracts]);

    useEffect(() => {
        // Reset loading state when inputs change
        setIsLoadingTotal(true);

        // Guard clause: wait until data is available
        if (!rewards || !data || Object.keys(rewards).length === 0 || Object.keys(data).length === 0) {
            return;
        }

        let totalUSD = new BigNumber(0);
        let totalTel = new BigNumber(0);

        Object.keys(rewards).forEach((ticker: string) => {
            const unclaimed = rewards[ticker] || null;
            if (unclaimed && data?.[ticker]?.USD) {
                totalUSD = totalUSD.plus(new BigNumber(unclaimed).multipliedBy(data[ticker].USD));
                totalTel = totalTel.plus(unclaimed);
            }
        });
        const _uniswapTelRewards = new BigNumber(uniswapTelRewards || 0);
        const _merklTelRewards = new BigNumber(merklTelRewards || 0);
        const telUsd = data?.TEL?.USD || 0;

        totalTel = totalTel.plus(_uniswapTelRewards).plus(_merklTelRewards);
        totalUSD = totalUSD
            .plus(_uniswapTelRewards.multipliedBy(telUsd))
            .plus(_merklTelRewards.multipliedBy(telUsd));

        setTotalValueTel(`${totalTel}`)
        const result = formatNumberToCurrencyString(totalUSD.toNumber());

        setTotalValueUSD(result);
        if (data !== null) {
            setIsLoadingTotal(false);
        }
    }, [data, rewards, uniswapTelRewards, merklTelRewards]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <h3 className="pb-4 text-3xl text-white-100">
                Portfolio
            </h3>
            <div className="grid gap-2 pb-5 w-full">
                <div className="bg-black/20 rounded-2xl p-4 flex flex-col gap-2">
                    <p className="text-blue-700 text-xs"
                    >{address}</p>
                    <div className="flex gap-2 ">
                        <Link href={"https://basescan.org/"} className="bg-black/20 hover:scale-110 duration-200 py-2 px-3 rounded-4xl flex items-center gap-2 h-fit">
                            <Image src={base} alt={"Base"} width={20} height={20} />
                            <p className="text-sm text-white">Explorer</p>
                            <ExternalLinkArrow hight={12} width={12} />
                        </Link>
                        <Link href={"https://polygonscan.com/"} className="bg-black/20 hover:scale-110 duration-200 py-2 px-3 rounded-4xl flex items-center gap-2 h-fit">
                            <Image src={polygon} alt={"Base"} width={20} height={20} />
                            <p className="text-sm text-white">Explorer</p>
                            <ExternalLinkArrow hight={12} width={12} />
                        </Link>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                    <div className="w-full bg-black/20 py-3 px-4 rounded-2xl">
                        <p className="text-sm text-primary">Total Stakes</p>
                        <p className="text-base text-white">{userTotalActiveStakedUSD}</p>
                    </div>
                    <div className="w-full bg-black/20 py-3 px-4 rounded-2xl">
                        <p className="text-sm text-primary">Total Unclaimed Rewards</p>
                        <div className="w-full flex justify-between gap-2">
                            {isLoadingTotal ?
                                <LoadingAnimation size={20} />
                                :
                                <div className="w-full flex justify-between items-end">
                                    <div className="flex gap-1 w-full items-center justify-start">
                                        <Image src={telcoin} alt={"Base"} width={20} height={20} />
                                        <p className="text-base text-white">
                                            {totalValueTel}
                                        </p>
                                    </div>
                                    <p className="text-xs text-primary">{totalValueUSD}</p>
                                </div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
