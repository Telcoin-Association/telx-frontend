import { NextRequest } from "next/server";
import { rpcProxyRejection } from "@/helpers/rpcProxy";
import { isRpcChain } from "@/lib/rpc";
import { alchemyRpcUrl, siteOrigin } from "../../backendHelpers/alchemy";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/**
 * Same-origin JSON-RPC proxy for the browser. Read-only requests are forwarded
 * to Alchemy with the private key attached, so the key never ships to the
 * client. See src/helpers/rpcProxy.ts for the method allowlist.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  if (!isRpcChain(chain)) {
    return Response.json({ error: `Unknown chain: ${chain}` }, { status: 404, headers: JSON_HEADERS });
  }
  if (!process.env.ALCHEMY_ID) {
    console.error("ALCHEMY_ID is not set, so /api/rpc cannot reach Alchemy");
    return Response.json({ error: "RPC proxy is not configured" }, { status: 500, headers: JSON_HEADERS });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { headers: JSON_HEADERS }
    );
  }

  const rejected = rpcProxyRejection(body);
  if (rejected) return Response.json(rejected, { headers: JSON_HEADERS });

  const upstream = await fetch(alchemyRpcUrl(chain), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: siteOrigin() },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  return new Response(upstream.body, { status: upstream.status, headers: JSON_HEADERS });
}
