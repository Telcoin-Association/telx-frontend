import { RPC_MAX_BATCH } from "@/lib/rpc";

/**
 * Largest request body the proxy reads, in bytes. It matches ethers' default
 * batchMaxSize, so a legitimate batch stays under it.
 */
export const RPC_MAX_BODY_BYTES = 1 << 20;

/**
 * JSON-RPC methods the /api/rpc/[chain] proxy forwards to Alchemy: what the
 * browser's ethers provider and viem/wagmi clients call.
 * - contract reads (eth_call, eth_getCode) and the wallet balance RainbowKit shows
 * - receipt waits: ethers polls eth_getTransactionReceipt and eth_blockNumber;
 *   viem's waitForTransactionReceipt also reads the transaction and its block to
 *   detect a replaced transaction
 * - gas and nonce reads a wallet flow may make through the public client
 * Log and filter queries, proofs and storage reads are left out: nothing in the
 * browser needs them, and they are among the most expensive calls to serve.
 * Signing, broadcasting, subscriptions and Alchemy's enhanced (alchemy_*) APIs
 * are left out too: wallets broadcast their own transactions, and the proxy is
 * reachable by anyone.
 */
export const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
]);

export type JsonRpcId = string | number | null;

export type JsonRpcError = { code: number; message: string };

export type JsonRpcErrorResponse = { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

const INVALID_REQUEST: JsonRpcError = { code: -32600, message: "Invalid request" };

function requestId(request: unknown): JsonRpcId {
  if (request && typeof request === "object" && "id" in request) {
    const { id } = request;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}

function rejection(request: unknown): JsonRpcError | null {
  if (!request || typeof request !== "object" || !("method" in request)) return INVALID_REQUEST;
  const { method } = request;
  if (typeof method !== "string") return INVALID_REQUEST;
  if (!ALLOWED_RPC_METHODS.has(method)) {
    return { code: -32601, message: `Method not supported by this proxy: ${method}` };
  }
  return null;
}

function errorResponse(request: unknown, error: JsonRpcError): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", id: requestId(request), error };
}

/**
 * Decides whether a parsed JSON-RPC body (a single request or a batch) may be
 * forwarded. Returns null when every request names an allowed method.
 * Otherwise returns the response to send instead: one error per request,
 * mirroring the batch shape, so clients can match responses to requests.
 * A batch is rejected as a whole if any entry is disallowed. An empty batch,
 * or one longer than RPC_MAX_BATCH, gets a single error with a null id.
 */
export function rpcProxyRejection(body: unknown): JsonRpcErrorResponse | JsonRpcErrorResponse[] | null {
  if (!Array.isArray(body)) {
    const error = rejection(body);
    return error && errorResponse(body, error);
  }
  if (body.length === 0) return errorResponse(null, INVALID_REQUEST);
  if (body.length > RPC_MAX_BATCH) {
    return errorResponse(null, { code: -32600, message: `Batch too large: ${body.length} requests (limit ${RPC_MAX_BATCH})` });
  }

  const errors = body.map(rejection);
  const first = errors.find((error) => error !== null);
  if (!first) return null;

  return body.map((request, index) =>
    errorResponse(request, errors[index] ?? { code: -32600, message: `Batch rejected: ${first.message}` })
  );
}

/**
 * Decides whether a proxy request came from one of this site's own pages.
 * Returns null to allow it, or a short reason to deny it. Browsers cannot
 * forge Sec-Fetch-Site, and they always send Origin on POST, so this stops
 * other websites from spending our Alchemy quota through visitors' browsers.
 * Non-browser clients can set any header they like; this is not a defence
 * against them.
 */
export function crossOriginRejection(headers: Headers): string | null {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    return fetchSite === "same-origin" ? null : `not a same-origin request (Sec-Fetch-Site: ${fetchSite})`;
  }

  // Browsers without Sec-Fetch-Site (Safari before 16.4) still send Origin.
  const origin = headers.get("origin");
  if (origin === null) return "missing Origin header";

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return "unparsable Origin header";
  }
  const requestHost = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return requestHost !== "" && originHost === requestHost ? null : "origin host does not match";
}
