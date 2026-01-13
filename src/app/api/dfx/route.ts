
// File path: app/api/dfx/route.ts

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch("https://api.goldsky.com/api/public/dfx/subgraphs/dfx-v2-polygon/latest/gn", {
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
      console.error("Goldsky API Error:", errorText);
      return new Response(JSON.stringify({ error: "Failed to fetch data from Goldsky API (refer: web3/getContracts/dfx)" }), {
        status: response.status,
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (error) {
    console.error("Unexpected Error:", error);
    return new Response(JSON.stringify({ error: "Server error in /api/dfx" }), {
      status: 500,
    });
  }
}