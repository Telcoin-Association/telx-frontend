// Preview frontdoor: HTTP Basic auth plus a remember-me cookie, active only when PREVIEW_BASIC_AUTH is set.
// This runs in the edge middleware as well as in route handlers, so it uses Web Crypto rather than node:crypto.

/** Cookie that remembers a successful preview login so the browser is not prompted again. */
export const PREVIEW_AUTH_COOKIE = "telx-preview-auth";

/** Lifetime of the remember-me cookie in seconds (30 days). */
export const PREVIEW_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Attributes for the remember-me cookie. */
export const PREVIEW_AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: PREVIEW_AUTH_COOKIE_MAX_AGE,
} as const;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares two strings in time that depends only on their lengths. Callers pass SHA-256 hex digests,
 * which always have the same length, so the comparison reveals nothing about the secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The expected secret does not change within an instance, so its digest is computed once per secret.
let memoSecret: string | undefined;
let memoToken: Promise<string> | undefined;

/**
 * Value stored in the remember-me cookie: the hex SHA-256 of the expected
 * `user:password` string. The password itself never goes into the cookie, and
 * rotating the password invalidates every cookie issued before the change.
 */
export function previewAuthToken(expected: string): Promise<string> {
  if (memoSecret !== expected || !memoToken) {
    memoSecret = expected;
    memoToken = sha256Hex(expected);
  }
  return memoToken;
}

/**
 * Checks an HTTP `Authorization` header against the expected `user:password`
 * string for the preview frontdoor. The whole decoded credential is compared,
 * so passwords may contain colons. The comparison is over SHA-256 digests in
 * constant time. Resolves false on a missing header, a non-Basic scheme,
 * malformed base64, or a mismatch.
 */
export async function isPreviewAuthorized(authorization: string | null, expected: string): Promise<boolean> {
  if (!authorization?.startsWith("Basic ")) return false;
  let supplied: string;
  try {
    supplied = atob(authorization.slice(6));
  } catch {
    return false;
  }
  const [suppliedDigest, expectedDigest] = await Promise.all([sha256Hex(supplied), previewAuthToken(expected)]);
  return constantTimeEqual(suppliedDigest, expectedDigest);
}

export type PreviewAuthResult =
  | { authorized: false }
  /** `issueCookie` is set on a fresh Basic auth login, and is the value to store in the remember-me cookie. */
  | { authorized: true; issueCookie: string | null };

/**
 * Accepts a request that carries the remember-me cookie or valid Basic auth credentials. A request
 * authorized by credentials alone gets a cookie value to set, so the browser is not prompted again.
 */
export async function checkPreviewAuth(cookie: string | undefined, authorization: string | null, expected: string): Promise<PreviewAuthResult> {
  const token = await previewAuthToken(expected);
  if (cookie !== undefined && constantTimeEqual(cookie, token)) return { authorized: true, issueCookie: null };
  if (await isPreviewAuthorized(authorization, expected)) return { authorized: true, issueCookie: token };
  return { authorized: false };
}

/** Every value of one cookie in a Cookie request header (a name can appear more than once). */
function cookieValuesFromHeader(header: string | null, name: string): string[] {
  if (!header) return [];
  return header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator !== -1 && part.slice(0, separator).trim() === name ? [part.slice(separator + 1).trim()] : [];
  });
}

/**
 * Preview check for API routes, which middleware does not cover. Resolves null when PREVIEW_BASIC_AUTH
 * is unset (production pays one env lookup) or the request carries the remember-me cookie or valid Basic
 * credentials, and otherwise to a JSON 401.
 *
 * People log in on a page, and the cookie that sets is sent with the app's own API calls, so a logged-in
 * visitor passes without a prompt; cached Basic credentials are accepted too. The 401 deliberately has no
 * WWW-Authenticate header: a failed API call from a page must not open the browser's login dialog. Routes with their own bearer secret (cron, health)
 * do not use this, because both schemes share the Authorization header.
 */
export async function apiPreviewRejection(request: Request): Promise<Response | null> {
  const expected = process.env.PREVIEW_BASIC_AUTH;
  if (!expected) return null;

  const token = await previewAuthToken(expected);
  const cookies = cookieValuesFromHeader(request.headers.get("cookie"), PREVIEW_AUTH_COOKIE);
  if (cookies.some((value) => constantTimeEqual(value, token))) return null;
  if (await isPreviewAuthorized(request.headers.get("authorization"), expected)) return null;

  return Response.json({ error: "Preview login required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

/** The 401 that makes a browser show its Basic auth prompt. */
export function previewAuthChallenge(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TELx preview", charset="UTF-8"' },
  });
}
