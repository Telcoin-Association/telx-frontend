import "server-only";
import { BaseError } from "viem";

// Alchemy carries the API key as a path segment: /v2/<key> for JSON-RPC and /nft/v3/<key> for the NFT API.
const ALCHEMY_KEY_SEGMENT = /\/(v2|nft\/v3)\/[^/\s?#"'<>]+/g;

/** Removes Alchemy keys from `text`, both as URL path segments and as the raw `ALCHEMY_ID` value. */
export function redactSecrets(text: string): string {
  let redacted = text.replace(ALCHEMY_KEY_SEGMENT, "/$1/[redacted]");
  const key = process.env.ALCHEMY_ID;
  if (key) redacted = redacted.split(key).join("[redacted]");
  return redacted;
}

/**
 * One-line description of any thrown value, safe to write to server logs.
 *
 * viem errors are described by their name and `shortMessage`, which carries no request URL. viem's full
 * `message` includes `URL: <rpc url>`, and our server-side RPC URL has the Alchemy key in its path. Every
 * other value goes through `redactSecrets` as well, since its message may quote a URL too.
 */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) return redactSecrets(`${error.name}: ${error.shortMessage}`);
  if (error instanceof Error) return redactSecrets(`${error.name}: ${error.message}`);
  return redactSecrets(String(error));
}
