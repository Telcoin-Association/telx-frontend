import { useSyncExternalStore } from "react";

/*
 * One claim at a time, page-wide. Every claim, whether from a chain's card or from Claim all, runs through
 * `runExclusive`, so two wallet prompts can never race and a card's button stays off while Claim all is sending.
 */

let busy = false;
const listeners = new Set<() => void>();

function setBusy(next: boolean) {
  busy = next;
  listeners.forEach((listener) => listener());
}

/** Thrown by `runExclusive` when another claim is already running. */
export class ClaimInProgressError extends Error {
  constructor() {
    super("Another claim is in progress. Wait for it to finish, then try again.");
    this.name = "ClaimInProgressError";
  }
}

export function isClaimRunning(): boolean {
  return busy;
}

/** Runs `task` as the only claim in progress, or throws ClaimInProgressError when one is already running. */
export async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  if (busy) throw new ClaimInProgressError();
  setBusy(true);
  try {
    return await task();
  } finally {
    setBusy(false);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any claim on the page is running. */
export function useClaimRunning(): boolean {
  return useSyncExternalStore(subscribe, isClaimRunning, () => false);
}
