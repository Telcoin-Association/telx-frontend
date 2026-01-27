import { ACTIVE_BALANCER_POOLS_SUBGRAPH_IDS, DEPRECATED_BALANCER_POOLS_SUBGRAPH_IDS } from "@/lib/constants";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subgraphId = searchParams.get("subgraphId");

  if (!subgraphId) {
    return new Response(
      JSON.stringify({ error: "Balancer: Subgraph ID is required. Refer: api/backend/subgraphs/balancer.ts" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;
  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const allBalancerSubgraphIds = [
    ...ACTIVE_BALANCER_POOLS_SUBGRAPH_IDS,
    ...DEPRECATED_BALANCER_POOLS_SUBGRAPH_IDS, // include deprecated pools as well so we can continue to show charts data
  ];

  const baseUrl = allBalancerSubgraphIds.includes(subgraphId)
    ? `https://api.telx.network/api/v1/active/get/balancer/${subgraphId}`
    : `https://api.telx.network/api/v1/get/balancer/${subgraphId}`;

  try {
    const response = await fetch(baseUrl, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch data from: ${baseUrl}. Subgraph ID: ${subgraphId}`);
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
