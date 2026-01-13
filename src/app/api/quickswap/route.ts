// File path: app/api/quickswap/route.ts

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const quickswapApi=process.env.QUICKSWAP_API
  try {
    const body = await req.json();
    const response = await fetch(`${quickswapApi}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-cache",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("TheGraph QuickSwap API Error:", errorText);
      return new Response(JSON.stringify({ error: "Failed to fetch quickswap data from thegraph.com (refer: web3/getContracts/quickswap)" }), {
        status: response.status,
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (error) {
    console.error("Unexpected Error in /api/quickswap:", error);
    return new Response(JSON.stringify({ error: "Server error in /api/quickswap" }), {
      status: 500,
    });
  }
}
