/**
 * JSON-RPC methods the /api/rpc/[chain] proxy forwards to Alchemy. This covers
 * everything wagmi, viem and ethers need for contract reads, gas estimation,
 * block and log queries, and receipt polling. Signing, broadcasting,
 * subscriptions and Alchemy's enhanced (alchemy_*) APIs are left out on
 * purpose: wallets broadcast their own transactions, and the proxy is
 * reachable by anyone.
 */
export const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_createAccessList",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_newBlockFilter",
  "eth_newFilter",
  "eth_uninstallFilter",
  "net_version",
  "web3_clientVersion",
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
 * A batch is rejected as a whole if any entry is disallowed.
 */
export function rpcProxyRejection(body: unknown): JsonRpcErrorResponse | JsonRpcErrorResponse[] | null {
  if (!Array.isArray(body)) {
    const error = rejection(body);
    return error && errorResponse(body, error);
  }
  if (body.length === 0) return errorResponse(null, INVALID_REQUEST);

  const errors = body.map(rejection);
  const first = errors.find((error) => error !== null);
  if (!first) return null;

  return body.map((request, index) =>
    errorResponse(request, errors[index] ?? { code: -32600, message: `Batch rejected: ${first.message}` })
  );
}
