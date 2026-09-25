# Alchemy JWT authentication for server-side RPC

The Alchemy key already lives only on the server. Route handlers call Alchemy through the viem clients in `src/app/api/backendHelpers/alchemy.ts`, and the browser reaches Alchemy only through the `/api/rpc/[chain]` proxy. What is left is that `ALCHEMY_ID` is a long-lived bearer secret: anyone who reads it from an env var, a log line or a request URL can spend our quota until someone notices. This plan replaces it with Alchemy's JWT authentication. The server signs a token that lives ten minutes with an RSA private key that never leaves Vercel, Alchemy checks it against a public key we import, and rotation means importing a new public key instead of reissuing a shared secret.

## What Alchemy requires

Sources: the JWT guide at <https://www.alchemy.com/docs/how-to-use-jwts-for-api-requests> and the allowlist guide at <https://www.alchemy.com/docs/how-to-add-allowlists-to-your-apps-for-enhanced-security>.

- Algorithms: "We support the following algorithms: RS256, RS384, RS512, ECDSA256, ECDSA384, ECDSA512." The guide generates an RSA key with a 2048-bit modulus and signs with RS256, and this plan does the same.
- Public keys belong to an app: "Select the app for which you want to create JWT keys", then "click on the "Security" option in the left navigation bar" and "Click "Import Public Key"". The guide also says to paste the PEM with no trailing spaces or newlines.
- Key ID: "Once your public key is set up you should see a "Key Id" for your public key." It goes in the JWT header as `kid`, and "this key id is used by Alchemy to decide which public key should be used to verify the JWT signature, since you can set up multiple public keys in your account."
- Claims: the example signs an empty payload with `algorithm: 'RS256'`, `expiresIn: '10m'` and `header: { kid: KEY_ID }`. That yields `alg` and `kid` in the header and `iat` plus `exp` in the payload; the guide names no other required claim and no maximum lifetime, so both of those points are unverified.
- Header: the example sends ``'Authorization': `Bearer ${JWT}` ``.
- URL: "while API keys can be used either as a path parameter in the URL or in the HTTP request header, JWTs can only be used in the HTTP request header." The example posts to `https://eth-sepolia.g.alchemy.com/v2` with no key in the path, but no sentence says the key must be removed or what happens if both are sent, so that part is unverified.
- Key format: the guide's Node script exports the private key as PKCS#1. `jose` imports PKCS#8, so the commands below produce PKCS#8 instead, which is the same RSA key in a different wrapper.
- Domain allowlist: "If domain whitelist items are set, a missing `Origin` header in the API request will cause the request to fail." The page mentions no other header for domain checks, and it suggests "tools like Postman to manually set the `Origin` header" for testing, so the check is only as strong as a header any caller can set.
- JWT and allowlists together: neither page says whether allowlists apply to JWT requests. That is unverified and covered in the allowlist section below.

## One-time setup

Use a new Alchemy app per Vercel environment, each with its own key pair. A preview deployment then cannot sign tokens that production's app accepts, a runaway preview can be cut off by deleting its app without touching production, and each dashboard shows only its own traffic. Whether Alchemy also meters compute per app, so that a preview cannot drain production's budget, is unverified. The section on retiring the API key explains why these should be new apps rather than the current one.

Generate the pair outside the repo. `genpkey` writes a PKCS#8 private key and `pkey -pubout` writes the SPKI public key.

```sh
cd "$(mktemp -d)"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
head -1 private.pem public.pem   # BEGIN PRIVATE KEY, BEGIN PUBLIC KEY
```

In the new app, make sure Ethereum, Polygon and Base mainnet are served, since `ALCHEMY_HOSTS` calls all three, and copy the domain allowlist from the current app. Then open Security, choose Import Public Key, paste `public.pem` and note the Key Id it shows.

In the Vercel dashboard, add `ALCHEMY_JWT_PRIVATE_KEY` and `ALCHEMY_JWT_KEY_ID` to the matching environment, paste the whole PEM as a multi-line value, mark both Sensitive and then delete `private.pem`.

Repeat with a fresh pair for production and for development. Nobody needs the private key after it is in Vercel, because rotation always starts from a new pair. `ALCHEMY_ID` stays set in every environment until the cutover is verified, since it is the fallback in the dual-mode code below, and any env change needs a redeploy to take effect.

## Code changes

### New `src/app/api/backendHelpers/alchemyAuth.ts`

Signs the token and caches it per module instance, so a warm serverless instance signs roughly once every nine minutes. Two requests that race past the refresh point both sign, which is harmless.

```ts
import "server-only";
import { importPKCS8, SignJWT } from "jose";

const ALG = "RS256";
const LIFETIME_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 60_000;

let signingKey: Promise<CryptoKey> | undefined;
let cached: { token: string; refreshAt: number } | undefined;

export function jwtConfigured(): boolean {
  return Boolean(process.env.ALCHEMY_JWT_PRIVATE_KEY && process.env.ALCHEMY_JWT_KEY_ID);
}

/** Alchemy JWT, reused until less than a minute of its ten-minute life is left. */
export async function alchemyJwt(): Promise<string> {
  if (cached && Date.now() < cached.refreshAt) return cached.token;
  const issuedAt = Date.now();
  // Vercel keeps real newlines; a one-line .env.local value may hold literal "\n".
  signingKey ??= importPKCS8(process.env.ALCHEMY_JWT_PRIVATE_KEY!.replace(/\\n/g, "\n"), ALG);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: process.env.ALCHEMY_JWT_KEY_ID! })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(await signingKey);
  cached = { token, refreshAt: issuedAt + LIFETIME_MS - REFRESH_MARGIN_MS };
  return token;
}

/** Auth headers for one Alchemy request: a Bearer token in JWT mode, none in key mode. */
export async function alchemyAuthHeaders(): Promise<Record<string, string>> {
  return jwtConfigured() ? { Authorization: `Bearer ${await alchemyJwt()}` } : {};
}
```

### `src/app/api/backendHelpers/alchemy.ts`

The installed viem is 2.42.1. Its `HttpTransportConfig` in `node_modules/viem/_types/clients/transports/http.d.ts` has `fetchFn`, `fetchOptions`, `onFetchRequest` and `onFetchResponse`, and viem calls `fetchFn(args.url ?? url, args)` once per request after it has built the body and headers. `fetchOptions.headers` is a fixed object captured when the transport is created, so it cannot carry a token that expires. `onFetchRequest` could also return a replacement `RequestInit` asynchronously, but `fetchFn` lets the proxy route and the viem clients share one function.

```ts
import { alchemyAuthHeaders, jwtConfigured } from "./alchemyAuth";

export function alchemyRpcUrl(chain: RpcChain): string {
  const endpoint = `https://${ALCHEMY_HOSTS[chain]}.g.alchemy.com/v2`;
  return jwtConfigured() ? endpoint : `${endpoint}/${process.env.ALCHEMY_ID}`;
}

export function alchemyConfigured(): boolean {
  return jwtConfigured() || Boolean(process.env.ALCHEMY_ID);
}

/** fetch for Alchemy: fresh auth headers on every call, plus the Origin the domain allowlist expects. */
export async function alchemyFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", siteOrigin());
  for (const [name, value] of Object.entries(await alchemyAuthHeaders())) headers.set(name, value);
  return fetch(input, { ...init, headers });
}

function alchemyTransport(chain: RpcChain) {
  return http(alchemyRpcUrl(chain), { fetchFn: alchemyFetch });
}
```

The three exported public clients stay as they are. They are built at module load, so each instance picks its mode once, which matches Vercel only applying env changes on a redeploy.

### `src/app/api/rpc/[chain]/route.ts`

Swap the `process.env.ALCHEMY_ID` check for `alchemyConfigured()` and the upstream `fetch` for `alchemyFetch`. The route no longer needs `siteOrigin`, because `alchemyFetch` adds the Origin header.

```ts
import { alchemyConfigured, alchemyFetch, alchemyRpcUrl } from "../../backendHelpers/alchemy";

if (!alchemyConfigured()) {
  console.error("Neither the ALCHEMY_JWT_* pair nor ALCHEMY_ID is set, so /api/rpc cannot reach Alchemy");
  return Response.json({ error: "RPC proxy is not configured" }, { status: 500, headers: JSON_HEADERS });
}
// ...
const upstream = await alchemyFetch(alchemyRpcUrl(chain), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  cache: "no-store",
});
```

### Dual mode during rollout

`jwtConfigured()` is the only switch. With both JWT variables set, requests go to the bare `/v2` URL with a Bearer token; otherwise they use the keyed URL exactly as today, so preview and production flip independently. A half-set pair counts as off, and the Origin header is sent in both modes.

### `.env.sample` and `CONTRIBUTING.md`

Replace the Alchemy block in `.env.sample` with:

```sh
# Alchemy. Server-only. With both JWT values set the server signs short-lived tokens; otherwise ALCHEMY_ID is used.
# The private key is a PKCS#8 PEM. In .env.local wrap it in double quotes or write its newlines as \n.
ALCHEMY_JWT_PRIVATE_KEY=
ALCHEMY_JWT_KEY_ID=
ALCHEMY_ID=
```

In the credentials paragraph of `CONTRIBUTING.md`, keep the sentence that `ALCHEMY_ID` takes your own free key and add: "Production and preview authenticate with a JWT signed from `ALCHEMY_JWT_PRIVATE_KEY` and `ALCHEMY_JWT_KEY_ID`. Leave both blank locally and the key is used." The portfolio bullet should say "the Alchemy credentials" instead of "the Alchemy key".

### Dependency

Add `jose` with `npm install jose`. Version 6.1.3 is already in the lockfile as a dependency of `@coinbase/cdp-sdk`, so the package is not new to the tree. It signs through Web Crypto with no native dependencies, so it runs on the Node runtime these routes use today and on Edge if the proxy ever moves there; no route under `src/app/api` exports `runtime`. `jsonwebtoken`, which Alchemy's guide uses, would work on Node but depends on Node's crypto module.

jose 6 is ESM only: its `package.json` has `"type": "module"` and a single `webapi` export. `next/jest` skips `node_modules` unless a package is listed in `transpilePackages`, so add `transpilePackages: ["jose"]` to `next.config.ts` or the test cannot import it.

### Tests

Add `src/app/api/backendHelpers/alchemyAuth.test.ts` with the node environment docblock that `rpcProxy.test.ts` uses. `next/jest` already maps `server-only` to an empty module.

```ts
/**
 * @jest-environment node
 */
import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

beforeEach(() => {
  jest.resetModules(); // fresh token cache for each test
  process.env.ALCHEMY_JWT_PRIVATE_KEY = privateKey;
  process.env.ALCHEMY_JWT_KEY_ID = "test-kid";
});
afterEach(() => jest.useRealTimers());

it("signs RS256 with the kid and a ten minute lifetime", async () => {
  const { alchemyJwt } = await import("./alchemyAuth");
  const { payload, protectedHeader } = await jwtVerify(await alchemyJwt(), await importSPKI(publicKey, "RS256"));
  expect(protectedHeader).toEqual({ alg: "RS256", kid: "test-kid" });
  expect(payload.exp! - payload.iat!).toBe(600);
  expect(Math.abs(payload.iat! - Date.now() / 1000)).toBeLessThan(5);
});

it("reuses the token until a minute is left, then signs a new one", async () => {
  jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
  const { alchemyJwt } = await import("./alchemyAuth");
  const first = await alchemyJwt();
  jest.setSystemTime(Date.now() + 8 * 60_000);
  expect(await alchemyJwt()).toBe(first);
  jest.setSystemTime(Date.now() + 90_000);
  expect(await alchemyJwt()).not.toBe(first);
});
```

A third case should delete both variables and expect `alchemyAuthHeaders()` to resolve to an empty object, which pins the fallback.

## Rollout

1. Preview first: create the preview app and variables, redeploy, then probe the proxy. `/api/*` skips the preview Basic auth, so plain curl works and should print `0x1`, `0x89` and `0x2105`.

```sh
for c in ethereum polygon base; do curl -s -X POST "https://PREVIEW_HOST/api/rpc/$c" \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'; echo; done
```

2. Load a portfolio page for a wallet with Uniswap positions, which exercises the viem clients, and check that the new app's dashboard shows the requests. Whether the dashboard attributes requests to a Key ID is unverified.
3. Production next, with the same steps against the production app.
4. After a week on JWT everywhere, delete the `ALCHEMY_ID` branch from `alchemyRpcUrl` and `alchemyConfigured`, unset `ALCHEMY_ID` in Vercel and delete the old app. If contributors should keep using a free key locally, keep the fallback code and only unset `ALCHEMY_ID` in Vercel.

Retiring the key is why the setup uses new apps. Whether an app's API key can be switched off while the app keeps running is unverified, since neither guide covers it, and the docs sidebar lists a "How to Rotate API Keys" guide worth reading first. Until that is confirmed, assume the old key cannot be turned off on its own. The dependable route is to move each environment to a fresh app that only ever sees JWT traffic and delete the old app once its request count reaches zero. The new apps still have keys of their own, but those keys have never been in an env var, a log or a URL.

## Domain allowlist

The allowlist guide says a missing Origin header fails when a domain allowlist is set, and neither guide says whether that check applies to JWT requests. Keep sending Origin from `siteOrigin()` in both modes until a preview test proves it unnecessary: send a signed request straight to the preview app with no Origin and see whether it fails. If it passes, the allowlist adds little for server traffic, since the guide itself shows that any caller can set Origin.

## Key rotation runbook

1. Generate a new pair with the setup commands and import the public key in the same app's Security tab. The guide says multiple public keys can be set up, so the old one should keep working until it is deleted.
2. Replace `ALCHEMY_JWT_PRIVATE_KEY` and `ALCHEMY_JWT_KEY_ID` in that Vercel environment and redeploy.
3. Wait ten minutes after the deploy is promoted so tokens from old instances expire, then rerun the curl probe.
4. Delete the old public key. The guide does not describe deleting keys, so where that control lives and how fast it applies is unverified.

## Verification and rollback

- [ ] `npm test` passes, including `alchemyAuth.test.ts`.
- [ ] `npm run build` passes from a clean checkout, and `grep -rlE "ALCHEMY_JWT|BEGIN PRIVATE KEY" .next/static` prints nothing.
- [ ] The curl probe returns all three chain ids on preview, then on production.
- [ ] A portfolio page with Uniswap positions loads, and Vercel logs show no "RPC proxy is not configured" errors or upstream auth failures.
- [ ] The new app shows traffic and the old app's traffic falls to zero.

Rollback while dual mode exists: unset both JWT variables for the affected environment and redeploy, and requests go back to the keyed URL. Keep the old app until the fallback code is gone, because `ALCHEMY_ID` still points at it.

## Open questions for the Alchemy dashboard

1. Must a JWT request use the bare `/v2` URL, and what happens if the path also carries a key? The guide only shows the bare URL.
2. Does one token work on all three hosts for a single app? The guide says to pick "the app on the network where you will be making the API requests".
3. Do domain allowlists apply to JWT requests, and does a JWT request without Origin fail?
4. Is there a maximum lifetime, a required claim beyond `kid`, `iat` and `exp`, or a clock skew allowance?
5. Can an app's API key be disabled so that the app accepts only JWTs?
6. Does the dashboard show which Key ID authenticated a request, and does deleting a public key take effect immediately?
