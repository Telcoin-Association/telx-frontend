/**
 * The latest unix millisecond value accepted as a real date: the year 5138. Merkl sends 32-bit unix seconds,
 * so anything past this is a unit mix-up (milliseconds, microseconds or nanoseconds sent as seconds) or
 * garbage, and is treated as unknown. It sits well inside the range a `Date` can hold (8.64e15 ms).
 */
export const MAX_TIMESTAMP_MS = 1e14;

/** `value` when it is a finite unix millisecond timestamp after 1970 and before MAX_TIMESTAMP_MS, else null. */
export function timestampMsOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < MAX_TIMESTAMP_MS ? value : null;
}
