import "server-only";

import type { GraphClient } from "../graph";

/** Overrides for a fetcher. The crons pass none; tests pass a fake client and a fixed clock. */
export type FetchOptions = {
  client?: GraphClient;
  now?: number; // unix seconds
};
