import React from 'react'
import DatadogInit from './DataDogRum'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { Provider } from 'react-redux'
import { SkrimProvider } from '@/components/providers/SkrimProvider'
import AppLayout from '@/components/layout/AppLayout'
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { config } from "@/lib/wagmiClient";
import { store } from "@/redux/store";
import theme from "@/lib/walletTheme";
import { ToastContainer } from 'react-toastify'
import Script from "next/script";
const queryClient = new QueryClient();


export default function AllProviders({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const isProd = process.env.NODE_ENV === "production";

    return (
        <>
            <DatadogInit />
            <WagmiProvider config={config}>
                <QueryClientProvider client={queryClient}>
                    <RainbowKitProvider theme={theme}>
                        <Provider store={store}>
                            <SkrimProvider>
                                <AppLayout>
                                    {children}
                                </AppLayout>
                            </SkrimProvider>
                        </Provider>
                    </RainbowKitProvider>
                </QueryClientProvider>
            </WagmiProvider>
            <ToastContainer
                position="bottom-left"
                pauseOnHover={false}
                autoClose={15000}
                pauseOnFocusLoss={false}
                toastClassName={() =>
                    " border border-[#4967FF]/40 bg-theme-gradient text-white rounded-xl shadow-lg px-4 py-6 flex gap-1 items-center my-1"
                }
            />
            {isProd && (
                <>
                    <Script
                        strategy="afterInteractive"
                        src="https://www.googletagmanager.com/gtag/js?id=G-L4X5HF8QXP"
                    />
                    <Script id="google-analytics" strategy="afterInteractive">
                        {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', 'G-L4X5HF8QXP');
              `}
                    </Script>

                </>
            )}
        </>
    )
}
