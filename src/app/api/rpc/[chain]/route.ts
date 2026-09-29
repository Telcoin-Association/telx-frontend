import { NextRequest } from "next/server";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { RPC_MAX_BODY_BYTES, crossOriginRejection, rpcProxyRejection } from "@/helpers/rpcProxy";
import { isRpcChain } from "@/lib/rpc";
import { alchemyRpcUrl, siteOrigin } from "../../backendHelpers/alchemy";
import { describeError } from "../../backendHelpers/errors";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/** Upper bound on waiting for Alchemy's response headers, so a hung upstream returns a 502 instead of holding the function open. */
const RPC_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Same-origin JSON-RPC proxy for the browser. Read-only requests are forwarded
 * to Alchemy with the private key attached, so the key never ships to the
 * client. Requests that did not come from this site's own pages are refused
 * with a 403 before the body is read. See src/helpers/rpcProxy.ts for the
 * origin gate and the method allowlist.
 *
 * On a password-protected preview the proxy also requires the preview login;
 * see apiPreviewRejection. Middleware does not run on this route, so
 * production pays nothing for the check.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ chain: string }> }) {
  const previewRejected = await apiPreviewRejection(request);
  if (previewRejected) return previewRejected;

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

  // The timer covers the wait for response headers only. Once they arrive the body streams through, so a
  // large result that is still arriving is not cut off.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(alchemyRpcUrl(chain), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: siteOrigin() },
      // Re-serialise the parsed body rather than forwarding the raw text, so Alchemy receives exactly the
      // calls that were checked. Raw JSON with a duplicated "method" key would otherwise validate against
      // the last value while an upstream parser might act on the first.
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    return new Response(upstream.body, { status: upstream.status, headers: JSON_HEADERS });
  } catch (error) {
    console.error(`RPC proxy request to ${chain} failed:`, describeError(error));
    return Response.json({ error: "Upstream RPC request failed" }, { status: 502, headers: JSON_HEADERS });
  } finally {
    clearTimeout(timer);
  }
}
