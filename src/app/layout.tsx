"use client";

import React from 'react';
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import AllProviders from "./Providers";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AllProviders>
          {children}
        </AllProviders>
      </body>
    </html>
  );
}
