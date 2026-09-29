import "server-only";

import type { AbiEvent, Address, GetLogsReturnType, Hex, PublicClient } from "viem";

/**
 * The one server-side `eth_getLogs` reader, in two forms.
 *
 * - `readEventLogs` decodes one event of one contract over a range the caller keeps within the provider's
 *   limit, in one call with a timeout (the positions routes).
 * - `getLogs` and `readLogChunks` return raw logs for a topic filter; `readLogChunks` walks a longer range in
 *   chunks, splits a chunk the provider refuses for size, and yields one chunk at a time so a caller can
 *   checkpoint after each (the Uniswap v4 RPC pipeline). Validation and timing of those logs are the caller's.
 */

/** Upper bound on one eth_getLogs, retries included, so a hung upstream fails the request instead of holding the function open. */
export const LOG_READ_TIMEOUT_MS = 8_000;

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Resolves or rejects with `promise`, or rejects with TimeoutError after `ms`. The timer never outlives the race. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The part of a viem public client the log reader uses, so tests can pass a stub. */
export type LogClient = Pick<PublicClient, "getLogs">;

export type ReadLogsOptions<TEvent extends AbiEvent> = {
  address: Address;
  event: TEvent;
  /** Indexed argument filter, as viem's getLogs takes it. */
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  timeoutMs?: number;
};

/**
 * Decoded logs of one event from one contract over an inclusive block range, in a single eth_getLogs with a
 * timeout. Logs that do not decode against `event` are dropped (viem's strict mode), so every returned log
 * has all of its arguments. The caller keeps the range within the provider's limit.
 */
export async function readEventLogs<const TEvent extends AbiEvent>(
  client: LogClient,
  { address, event, args, fromBlock, toBlock, timeoutMs = LOG_READ_TIMEOUT_MS }: ReadLogsOptions<TEvent>,
): Promise<GetLogsReturnType<TEvent, [TEvent], true>> {
  const request = client.getLogs({ address, event, args, fromBlock, toBlock, strict: true } as Parameters<LogClient["getLogs"]>[0]);
  return (await withTimeout(request, timeoutMs, "eth_getLogs")) as GetLogsReturnType<TEvent, [TEvent], true>;
}

/** The one RPC method this module needs. A viem PublicClient satisfies it. */
export type RpcRequester = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
};

/** A topic position: one value, any of several values, or a wildcard. */
export type TopicFilter = Hex | readonly Hex[] | null;

export type LogFilter = {
  address: Address | readonly Address[];
  topics: readonly TopicFilter[];
};

/** A log with numeric positions. `blockTimestamp` is unix seconds, null when the node does not send it. */
export type ChainLog = {
  address: Address;
  blockNumber: number;
  blockHash: Hex;
  blockTimestamp: number | null;
  transactionHash: Hex;
  logIndex: number;
  data: Hex;
  topics: Hex[];
  removed: boolean;
};

/** A log as the JSON-RPC node returns it. */
export type RawLog = {
  address: Address;
  blockNumber: Hex;
  blockHash: Hex;
  blockTimestamp?: Hex | null;
  transactionHash: Hex;
  logIndex: Hex;
  data: Hex;
  topics: Hex[];
  removed?: boolean;
};

export type LogChunk = { fromBlock: number; toBlock: number; logs: ChainLog[] };

export type ReadLogChunksOptions = {
  /** Largest block span per call. The reader never asks for more. */
  maxSpan: number;
  /** Pauses before each retry of a call the provider rate-limited; once they run out, the error is thrown. */
  rateLimitDelaysMs?: readonly number[];
};

export const RATE_LIMIT_DELAYS_MS: readonly number[] = [500, 1_500, 3_000];

/** Chunks returning fewer logs than this let the next chunk double its span again. */
const GROW_BELOW_LOGS = 2500;

export const toHex = (n: number): Hex => `0x${n.toString(16)}`;

/**
 * Text of an error and its causes. viem wraps an RPC error and keeps the provider's message in `details`;
 * the provider's own text is what names the range problem.
 */
function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth++) {
    if (typeof current !== "object") {
      parts.push(String(current));
      break;
    }
    const { message, details, shortMessage } = current as { message?: unknown; details?: unknown; shortMessage?: unknown };
    for (const part of [details, shortMessage, message]) if (typeof part === "string") parts.push(part);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

// Phrases providers use when a getLogs call covers too many blocks or would return too many logs.
const RANGE_ERROR =
  /block range|range (is )?too (large|wide)|too many (results|logs)|response size|logs? (limit|cap)|10,?000 results|query returned more than/i;

// A rate limit or capacity refusal (Alchemy: HTTP 429, "exceeded its compute units per second capacity").
// The same range succeeds after a pause, so it is retried rather than split.
const RATE_LIMIT_ERROR = /\b429\b|too many requests|rate limit|compute units per second|capacity/i;

/** True when the provider refused a getLogs call for its size rather than for a real failure. */
export function isRangeError(error: unknown): boolean {
  return !isRateLimitError(error) && RANGE_ERROR.test(errorText(error));
}

/** True when the provider refused a call for its rate or capacity. */
export function isRateLimitError(error: unknown): boolean {
  return RATE_LIMIT_ERROR.test(errorText(error));
}

/**
 * The span a provider suggests in its range error, if any. Alchemy answers with
 * "this block range should work: [0x0, 0x52baa59]".
 */
export function suggestedSpan(error: unknown): number | null {
  const match = /\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]/i.exec(errorText(error));
  if (!match) return null;
  const span = Number.parseInt(match[2], 16) - Number.parseInt(match[1], 16) + 1;
  return Number.isFinite(span) && span > 0 ? span : null;
}

export function parseLog(raw: RawLog): ChainLog {
  const ts = raw.blockTimestamp ? Number.parseInt(raw.blockTimestamp, 16) : Number.NaN;
  return {
    address: raw.address,
    blockNumber: Number.parseInt(raw.blockNumber, 16),
    blockHash: raw.blockHash,
    blockTimestamp: Number.isFinite(ts) ? ts : null,
    transactionHash: raw.transactionHash,
    logIndex: Number.parseInt(raw.logIndex, 16),
    data: raw.data,
    topics: raw.topics,
    removed: raw.removed === true,
  };
}

/** One getLogs call, sorted by block and log index. */
export async function getLogs(client: RpcRequester, filter: LogFilter, fromBlock: number, toBlock: number): Promise<ChainLog[]> {
  const raw = (await client.request({
    method: "eth_getLogs",
    params: [{ address: filter.address, topics: filter.topics, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) }],
  })) as RawLog[] | null;
  return (raw ?? []).map(parseLog).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

/**
 * Reads `[fromBlock, toBlock]` in consecutive chunks, yielding each one in order. The first call covers as
 * much as `maxSpan` allows. A chunk the provider refuses for size is retried with the span it suggests, or
 * half the span; a single block that is still refused throws. A rate-limited call is retried after each of
 * `rateLimitDelaysMs` in turn, with the same span. After a chunk with few logs the span doubles again, up to
 * `maxSpan`. Any other error is thrown as it is.
 */
export async function* readLogChunks(
  client: RpcRequester,
  filter: LogFilter,
  fromBlock: number,
  toBlock: number,
  options: ReadLogChunksOptions,
): AsyncGenerator<LogChunk> {
  const maxSpan = Math.max(1, Math.floor(options.maxSpan));
  const delays = options.rateLimitDelaysMs ?? RATE_LIMIT_DELAYS_MS;
  let span = maxSpan;
  let from = fromBlock;
  let retries = 0;

  while (from <= toBlock) {
    const to = Math.min(toBlock, from + span - 1);
    let logs: ChainLog[];
    try {
      logs = await getLogs(client, filter, from, to);
    } catch (error) {
      if (isRateLimitError(error) && retries < delays.length) {
        await new Promise(resolve => setTimeout(resolve, delays[retries++]));
        continue;
      }
      const current = to - from + 1;
      if (!isRangeError(error) || current <= 1) throw error;
      const suggested = suggestedSpan(error);
      span = Math.max(1, suggested !== null && suggested < current ? suggested : Math.floor(current / 2));
      continue;
    }
    retries = 0;
    yield { fromBlock: from, toBlock: to, logs };
    from = to + 1;
    // A chunk near the provider's log cap would fail again at twice the span, so only sparse chunks grow.
    if (logs.length < GROW_BELOW_LOGS) span = Math.min(maxSpan, span * 2);
  }
}
