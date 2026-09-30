import React from "react";
import Link from "next/link";

export const metadata = { title: "Page not found | TELx" };

/** The 404 page, used for unknown routes and for pool ids the registry does not list. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center text-white">
      <h1 className="text-2xl">Page not found</h1>
      <p className="text-sm text-primary">This page or pool is not listed on TELx. Check the link, or find the pool in the list.</p>
      <Link href="/pools" className="rounded-lg bg-ocean-gradient px-6 py-2 text-sm font-bold text-white">
        Browse all pools
      </Link>
    </main>
  );
}
