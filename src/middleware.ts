import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PREVIEW_AUTH_COOKIE, PREVIEW_AUTH_COOKIE_OPTIONS, checkPreviewAuth, previewAuthChallenge } from "./helpers/previewAuth";

/**
 * Preview Basic auth for pages, active only when PREVIEW_BASIC_AUTH is set. Security headers are static
 * and live in next.config.ts. API routes are outside the matcher and apply the same login themselves
 * through apiPreviewRejection, so production API calls never pass through middleware.
 */
export async function middleware(request: NextRequest) {
  const expected = process.env.PREVIEW_BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const result = await checkPreviewAuth(request.cookies.get(PREVIEW_AUTH_COOKIE)?.value, request.headers.get("authorization"), expected);
  if (!result.authorized) return previewAuthChallenge();

  const response = NextResponse.next();
  if (result.issueCookie) {
    // Secure only over https, so a preview password set for Development still works on plain http (for
    // example a phone on the local network), where browsers drop Secure cookies.
    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set(PREVIEW_AUTH_COOKIE, result.issueCookie, { ...PREVIEW_AUTH_COOKIE_OPTIONS, secure });
  }
  return response;
}

export const config = {
  // Pages only: not API routes, not Next.js internals, and not public static files. Static files are matched
  // by extension rather than by any dot, so page data such as `/pools.rsc` still requires the preview login.
  // Router prefetches are matched too: a client chooses its own request headers, so skipping requests that
  // claim to be prefetches would let anyone read pages without the login.
  matcher: ["/((?!api/|_next/|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|txt|xml|js|css|map|woff2?|webmanifest)$).*)"],
};
