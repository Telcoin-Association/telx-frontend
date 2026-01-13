import React from "react";

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Image from "next/image";
export const CustomConnectButton = () => {
    return (
        <ConnectButton.Custom>
            {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                authenticationStatus,
                mounted,
            }) => {
                // Note: If your app doesn't use authentication, you
                // can remove all 'authenticationStatus' checks
                const ready = mounted && authenticationStatus !== 'loading';
                const connected =
                    ready &&
                    account &&
                    chain &&
                    (!authenticationStatus ||
                        authenticationStatus === 'authenticated');
                return (
                    <div
                        {...(!ready && {
                            'aria-hidden': true,
                            'style': {
                                opacity: 0,
                                pointerEvents: 'none',
                                userSelect: 'none',
                            },
                        })}
                    >
                        {(() => {
                            if (!connected) {
                                return (
                                    <button onClick={openConnectModal} type="button" className="text-sm bg-ocean-gradient py-2 px-3 rounded-xl drop-shadow-2xl font-black text-white hover:scale-105 cursor-pointer duration-200">
                                        Connect
                                    </button>
                                );
                            }
                            if (chain.unsupported) {
                                return (
                                    <button onClick={openChainModal} type="button" className="text-sm bg-ocean-gradient py-2 px-3 rounded-xl drop-shadow-2xl font-black text-white hover:scale-105 cursor-pointer duration-200">
                                        Wrong network
                                    </button>
                                );
                            }
                            return (
                                <div style={{ display: 'flex', gap: 12 }}>
                                    {/* This is the chain switch button. It can be used later when we migrate the app to support multiple chains. */}
                                    {/* <button
                                        onClick={openChainModal}
                                        style={{ display: 'flex', alignItems: 'center' }}
                                        type="button"
                                        className="bg-ocean-gradient py-2 px-3 rounded-xl drop-shadow-2xl font-black text-white hover:scale-105 cursor-pointer duration-200"
                                    >
                                        {chain.hasIcon && (
                                            <div
                                                style={{
                                                    background: chain.iconBackground,
                                                    width: 16,
                                                    height: 16,
                                                    borderRadius: 999,
                                                    overflow: 'hidden',
                                                    marginRight: 4,
                                                }}
                                            >
                                                {chain.iconUrl && (
                                                    <img
                                                        alt={chain.name ?? 'Chain icon'}
                                                        src={chain.iconUrl}
                                                        style={{ width: 16, height: 16 }}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        {chain.name}
                                    </button> */}
                                    <button onClick={openAccountModal} type="button" className="text-sm bg-ocean-gradient py-2 px-3 rounded-xl drop-shadow-2xl font-black text-white hover:scale-105 cursor-pointer duration-200 flex items-center gap-1">
                                        <div
                                            style={{
                                                background: chain.iconBackground,
                                                width: 18,
                                                height: 19,
                                                borderRadius: 999,
                                                overflow: 'hidden',
                                                marginRight: 4,
                                            }}
                                        >
                                            {chain.iconUrl && (
                                                <Image
                                                    alt={chain.name ?? 'Chain icon'}
                                                    src={chain.iconUrl}
                                                    style={{ width: 18, height: 18 }}
                                                    height={18}
                                                    width={18}
                                                />
                                            )}
                                        </div>
                                        <p>
                                            {account.displayName}
                                        </p>
                                        {/* <p className="hidden sm:block text-status-complete font-normal">
                                            {account.displayBalance
                                                ? ` (${account.displayBalance})`
                                                : ''}
                                        </p> */}
                                    </button>
                                </div>
                            );
                        })()}
                    </div>
                );
            }}
        </ConnectButton.Custom>
    );
};