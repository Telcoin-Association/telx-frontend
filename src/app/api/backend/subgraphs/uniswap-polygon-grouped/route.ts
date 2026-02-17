import { NextResponse } from "next/server";

export async function GET(req: Request) {

  const backendUrl = new URL(
    "https://api.telx.network/api/v1/active/get/uniswap-polygon-grouped"
    // "http://localhost:3001/api/v1/active/get/uniswap-polygon-grouped"
  );
  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const r = await fetch(
    backendUrl,
    { headers }
  );

  const data = await r.json();

  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json(
      { error: "Backend request failed", status: r.status, body: text },
      { status: r.status }
    );
  }

  return NextResponse.json(data.data);
}
