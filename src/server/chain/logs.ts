import "server-only";
import type { AbiEvent, Address, GetLogsReturnType, PublicClient } from "viem";

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
