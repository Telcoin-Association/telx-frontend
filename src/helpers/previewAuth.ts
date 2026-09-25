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
