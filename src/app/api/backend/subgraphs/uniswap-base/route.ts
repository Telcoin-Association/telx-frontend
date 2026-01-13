import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolAddress = searchParams.get("poolAddress");

  if (!poolAddress) {
    return new Response(
      JSON.stringify({
        error: "Uniswap: Pool address is required. Refer: api/backend/subgraphs/uniswap-base/route.ts",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;
  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  try {
    const response = await fetch(
      `https://api.telx.network/api/v1/active/get/uniswap-base/${poolAddress}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch data: /api/backend/subgraphs/uniswap-base. Pool: ${poolAddress}`
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
