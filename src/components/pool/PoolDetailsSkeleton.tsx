"use client";

import React from "react";
import Link from "next/link";
import { SkeletonValue } from "./PoolListSkeleton";
import { useAppSelector } from "@/redux/hooks";
import { contractsErrorSelector, failedAttemptsSelector, LOAD_RETRY_DELAYS_MS } from "@/redux/slices/contractsSlice";

/**
 * The pool page while its data loads, in the page's own layout: the breadcrumb, the info column and the
 * chart area. Once the load has failed for good it says so instead of pulsing.
 */
export default function PoolDetailsSkeleton() {
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
  const unavailable = lastError !== null && failedAttempts > LOAD_RETRY_DELAYS_MS.length;

  return (
    <div className="flex flex-col gap-4" aria-busy={!unavailable} aria-label="Loading pool">
      <div className="flex w-fit gap-2 px-4 xl:px-0">
        <Link href="/pools" className="text-sm text-primary hover:text-white">
          Pools
        </Link>
        <SkeletonValue unavailable={false} className="w-24" />
      </div>
      <div className="grid grid-cols-1 px-4 md:grid-cols-3 md:gap-4 md:rounded-xl md:px-0">
        <div className="order-2 mt-4 flex flex-col gap-2 md:order-1 md:mt-0">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center justify-between rounded-2xl bg-black/20 px-4 py-4">
              <SkeletonValue unavailable={false} className="w-20" />
              <SkeletonValue unavailable={unavailable} className="w-24" />
            </div>
          ))}
        </div>
        <div className="order-1 col-span-2 md:order-2">
          <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2 rounded-xl bg-black/20 p-6">
            {unavailable ? (
              <p className="text-sm text-primary">Pool data could not be loaded. Reload the page to try again.</p>
            ) : (
              <span aria-hidden="true" data-testid="skeleton" className="block h-full min-h-60 w-full animate-pulse rounded-lg bg-white/5" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
