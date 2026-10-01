import React, { Suspense } from "react";
import { Metadata } from "next";
import SwapPage from "./SwapPage";

const TITLE = "Swap - TELx Network";
const DESCRIPTION = "Swap tokens on Ethereum, Polygon and Base through the 0x Swap API, which charges a 0.15% fee on some pairs. TELx adds no fee of its own.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: "TELx, Swap, TEL, eUSD, eMXN, USDC, 0x, Ethereum, Polygon, Base",
  openGraph: {
    title: "TELx - Swap",
    description: DESCRIPTION,
    url: "https://telx.network/swap",
    siteName: "TELx Network",
    images: [
      {
        url: `/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`,
        width: 1200,
        height: 630,
        alt: "TELx Network",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TELx - Swap",
    description: DESCRIPTION,
    images: [`/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`],
    creator: "@telcoin_team",
  },
  metadataBase: new URL("https://telx.network"),
};

// SwapPage reads the query string (to prefill a swap), which needs a Suspense boundary for static rendering.
export default function Page() {
  return (
    <Suspense>
      <SwapPage />
    </Suspense>
  );
}
