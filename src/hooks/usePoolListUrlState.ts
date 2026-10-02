"use client";

import { useEffect, useState } from "react";
import { EMPTY_TOKEN_FILTER, readPoolListUrlState, writePoolListUrlState, type PoolListUrlState } from "@/lib/poolTokenFilter";

const EMPTY_STATE: PoolListUrlState = { ...EMPTY_TOKEN_FILTER, chain: "all" };

/**
 * A pool list's search, token and chain filters, kept in the page's query string. The state starts empty so the
 * server and first client render agree, is read from the URL once mounted, and every later change replaces the
 * current history entry rather than adding one.
 */
export function usePoolListUrlState() {
  const [state, setState] = useState<PoolListUrlState>(EMPTY_STATE);
  // Writes wait until the state read from the URL has rendered, so the empty initial state never overwrites it.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(readPoolListUrlState(window.location.search));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const query = writePoolListUrlState(window.location.search, state);
    const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [state, ready]);

  const update = (patch: Partial<PoolListUrlState>) => setState((current) => ({ ...current, ...patch }));
  const reset = () => setState(EMPTY_STATE);

  return { state, update, reset };
}
