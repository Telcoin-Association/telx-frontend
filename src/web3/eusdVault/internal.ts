import type { Hash } from "viem";

/** Small helpers the vault modules share. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `error` itself when it is an `Error`, otherwise an `Error` carrying its string form. */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The error an aborted `AbortSignal` rejects with. */
export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Matched by name, so an abort raised by another library's copy of the class counts too. */
export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

/** True only when both hashes are present and equal ignoring case; a missing hash matches nothing, not even another. */
export function sameHash(a: Hash | undefined, b: Hash | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

export type BackoffTimings = Readonly<{ minBackoffMs: number; maxBackoffMs: number }>;

/** Doubles from `minBackoffMs` at attempt 1 up to `maxBackoffMs`. An attempt below 1 waits the minimum. */
export function backoffMs(attempt: number, t: BackoffTimings): number {
  return Math.min(t.maxBackoffMs, t.minBackoffMs * 2 ** Math.max(0, attempt - 1));
}
