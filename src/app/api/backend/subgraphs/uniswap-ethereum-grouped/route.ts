import { NextResponse } from "next/server";

export async function GET(req: Request) {

  const backendUrl = new URL(
    "https://api.telx.network/api/v1/active/get/uniswap-ethereum-grouped"
    // "http://localhost:3002/api/v1/active/get/uniswap-ethereum-grouped"
  );
  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const r = await fetch(
    backendUrl,
    { headers }
  );

  if (!r.ok) {
    const text = await r.text();
    if (r.status === 404) {
      return NextResponse.json([]);
    }
    return NextResponse.json(
      { error: "Backend request failed", status: r.status, body: text },
      { status: r.status }
    );
  }

  const data = await r.json();

  return NextResponse.json(data.data);
}
