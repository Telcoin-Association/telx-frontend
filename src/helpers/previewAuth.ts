/**
 * Checks an HTTP `Authorization` header against the expected `user:password`
 * string for the preview frontdoor. The whole decoded credential is compared,
 * so passwords may contain colons. Returns false on a missing header, a
 * non-Basic scheme, malformed base64, or a mismatch.
 */
export function isPreviewAuthorized(authorization: string | null, expected: string): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    return atob(authorization.slice(6)) === expected;
  } catch {
    return false;
  }
}

/** Cookie that remembers a successful preview login so the browser is not prompted again. */
export const PREVIEW_AUTH_COOKIE = "telx-preview-auth";

/** Lifetime of the remember-me cookie in seconds (30 days). */
export const PREVIEW_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Value stored in the remember-me cookie: the hex SHA-256 of the expected
 * `user:password` string. The password itself never goes into the cookie, and
 * rotating the password invalidates every cookie issued before the change.
 */
export async function previewAuthToken(expected: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
