import { NextRequest } from "next/server";
import { PREVIEW_AUTH_COOKIE, checkPreviewAuth, previewAuthChallenge } from "@/helpers/previewAuth";
import { RPC_MAX_BODY_BYTES, crossOriginRejection, rpcProxyRejection } from "@/helpers/rpcProxy";
import { isRpcChain } from "@/lib/rpc";
import { alchemyRpcUrl, siteOrigin } from "../../backendHelpers/alchemy";
import { describeError } from "../../backendHelpers/errors";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/**
 * Same-origin JSON-RPC proxy for the browser. Read-only requests are forwarded
 * to Alchemy with the private key attached, so the key never ships to the
 * client. Requests that did not come from this site's own pages are refused
 * with a 403 before the body is read. See src/helpers/rpcProxy.ts for the
 * origin gate and the method allowlist.
 *
 * When PREVIEW_BASIC_AUTH is set, the proxy also requires the preview login
 * (the remember-me cookie or Basic credentials), because it spends our Alchemy
 * quota. Middleware does not run on this route, so production pays nothing
 * for the check.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ chain: string }> }) {
  const previewSecret = process.env.PREVIEW_BASIC_AUTH;
  if (previewSecret) {
    const preview = await checkPreviewAuth(request.cookies.get(PREVIEW_AUTH_COOKIE)?.value, request.headers.get("authorization"), previewSecret);
    if (!preview.authorized) return previewAuthChallenge();
  }

  const denied = crossOriginRejection(request.headers);
  if (denied) return Response.json({ error: `Forbidden: ${denied}` }, { status: 403, headers: JSON_HEADERS });

  const { chain } = await params;
  if (!isRpcChain(chain)) {
    return Response.json({ error: `Unknown chain: ${chain}` }, { status: 404, headers: JSON_HEADERS });
  }
  if (!process.env.ALCHEMY_ID) {
    console.error("ALCHEMY_ID is not set, so /api/rpc cannot reach Alchemy");
    return Response.json({ error: "RPC proxy is not configured" }, { status: 500, headers: JSON_HEADERS });
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > RPC_MAX_BODY_BYTES) {
    return Response.json({ error: "Request body too large" }, { status: 413, headers: JSON_HEADERS });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { headers: JSON_HEADERS }
    );
  }

  const rejected = rpcProxyRejection(body);
  if (rejected) return Response.json(rejected, { headers: JSON_HEADERS });

  try {
    const upstream = await fetch(alchemyRpcUrl(chain), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: siteOrigin() },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return new Response(upstream.body, { status: upstream.status, headers: JSON_HEADERS });
  } catch (error) {
    console.error(`RPC proxy request to ${chain} failed:`, describeError(error));
    return Response.json({ error: "Upstream RPC request failed" }, { status: 502, headers: JSON_HEADERS });
  }
}
