import React from "react";
import { Metadata } from "next";
import EusdVaultPage from "./EusdVaultPage";

const TITLE = "eUSD Vault - TELx Network";
const DESCRIPTION = "Swap USDC and eUSD at the peg-stability vault on Ethereum, Polygon and Base.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: "TELx, eUSD, USDC, Stablecoin, Peg Stability Vault, Swap, Ethereum, Polygon, Base",
  openGraph: {
    title: "TELx - eUSD Vault",
    description: DESCRIPTION,
    url: "https://telx.network/eusd-vault",
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
    title: "TELx - eUSD Vault",
    description: DESCRIPTION,
    images: [`/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`],
    creator: "@telcoin_team",
  },
  metadataBase: new URL("https://telx.network"),
};

export default function Page() {
  return <EusdVaultPage />;
}
