import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PREVIEW_AUTH_COOKIE, PREVIEW_AUTH_COOKIE_OPTIONS, checkPreviewAuth, previewAuthChallenge } from "./helpers/previewAuth";

/**
 * Preview Basic auth for pages, active only when PREVIEW_BASIC_AUTH is set. Security headers are static
 * and live in next.config.ts. The RPC proxy runs the same check in its own handler, so production RPC
 * calls never pass through middleware.
 */
export async function middleware(request: NextRequest) {
  const expected = process.env.PREVIEW_BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const result = await checkPreviewAuth(request.cookies.get(PREVIEW_AUTH_COOKIE)?.value, request.headers.get("authorization"), expected);
  if (!result.authorized) return previewAuthChallenge();

  const response = NextResponse.next();
  if (result.issueCookie) response.cookies.set(PREVIEW_AUTH_COOKIE, result.issueCookie, PREVIEW_AUTH_COOKIE_OPTIONS);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not API routes, not Next.js internals, and not static files (any path with a file extension).
      source: "/((?!api/|_next/|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
