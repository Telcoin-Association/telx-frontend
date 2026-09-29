import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PREVIEW_AUTH_COOKIE,
  PREVIEW_AUTH_COOKIE_OPTIONS,
  checkPreviewAuth,
  previewAuthChallenge,
  previewLoginRequired,
} from "./helpers/previewAuth";

// API routes that authenticate with their own bearer secret. Basic auth uses the same Authorization header,
// so the preview login must not stand in front of them.
const OWN_AUTH_API = /^\/api\/(?:cron|health)(?:\/|$)/;

/**
 * Preview Basic auth, active only when PREVIEW_BASIC_AUTH is set. The matcher below leaves out the
 * production hosts, so this runs on every path of every other host: pages, page data, static files, API
 * routes and prefetches alike. Security headers are static and live in next.config.ts.
 *
 * A page without the login gets the Basic challenge, which makes the browser ask for the password. An API
 * route gets a plain JSON 401 instead, so a failed call from a page never opens the login dialog; the
 * remember-me cookie set on the page login is what the app's own API calls carry.
 */
export async function middleware(request: NextRequest) {
  const expected = process.env.PREVIEW_BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (OWN_AUTH_API.test(pathname)) return NextResponse.next();

  const result = await checkPreviewAuth(request.cookies.get(PREVIEW_AUTH_COOKIE)?.value, request.headers.get("authorization"), expected);
  if (!result.authorized) return pathname.startsWith("/api/") ? previewLoginRequired() : previewAuthChallenge();

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
  // Every path on every host except production. Deciding by host rather than by path means no page, file
  // or future route can fall outside the preview login because of its shape, and production never runs the
  // middleware at all. Next anchors the host pattern at both ends and ignores case and port, so
  // `staging.telx.network` and `telx.network.example.com` still get the login.
  matcher: [{ source: "/:path*", missing: [{ type: "host", value: "(?:www\\.)?telx\\.network" }] }],
};
