import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolAddress = searchParams.get("poolAddress");

  if (!poolAddress) {
    return new Response(
      JSON.stringify({
        error: "DFX: Pool address is required. Refer: api/backend/subgraphs/dfx.ts",
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
      // `https://api.telx.network/api/v1/get/dfx/${poolAddress}`,
      `https://telx-network-backend-seven.vercel.app/api/v1/get/dfx/${poolAddress}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch data: /api/backend/subgraphs/dfx. Pool: ${poolAddress}`
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
