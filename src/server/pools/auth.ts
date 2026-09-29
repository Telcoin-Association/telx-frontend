import "server-only";

import { timingSafeEqual } from "crypto";

/** Compares an Authorization header with `Bearer <secret>` in constant time for equal lengths. */
export function bearerMatches(authHeader: string, secret: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(authHeader);
  const b = encoder.encode(`Bearer ${secret}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type SecretName = "CRON_SECRET" | "HEALTH_CHECK_SECRET";

export type BearerCheck = { ok: true } | { ok: false; status: 401 | 500 };

/**
 * Requires `Authorization: Bearer <secret>` where the secret is read from `secretName` on every call.
 * An unset secret fails closed with 500: a misconfiguration, never an open route.
 */
export function checkBearer(headers: Headers, secretName: SecretName): BearerCheck {
  const secret = process.env[secretName];
  if (!secret) {
    console.error(`${secretName} is not set`);
    return { ok: false, status: 500 };
  }
  if (!bearerMatches(headers.get("authorization") ?? "", secret)) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
