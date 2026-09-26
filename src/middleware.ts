import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import {
  PREVIEW_AUTH_COOKIE,
  PREVIEW_AUTH_COOKIE_MAX_AGE,
  isPreviewAuthorized,
  previewAuthToken,
} from "./helpers/previewAuth";

export async function middleware(request: NextRequest) {
  const previewAuth = process.env.PREVIEW_BASIC_AUTH;
  // Set only on a fresh Basic auth login; the cookie then stands in for the header.
  let previewCookie: string | undefined;
  if (previewAuth) {
    const token = await previewAuthToken(previewAuth);
    const remembered = request.cookies.get(PREVIEW_AUTH_COOKIE)?.value === token;
    if (!remembered && !isPreviewAuthorized(request.headers.get("authorization"), previewAuth)) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="TELx preview", charset="UTF-8"' },
      });
    }
    if (!remembered) previewCookie = token;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const cspHeader = `
    default-src 'self';
    img-src 'self' data: blob: https://storage.googleapis.com https://assets.coingecko.com https://explorer-api.walletconnect.com *.vercel.app https://vercel-storage.com https://*.vercel-storage.com https://vercel.live https://vercel.com https://sockjs-mt1.pusher.com https://assets.vercel.com;
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://verify.walletconnect.com https://verify.walletconnect.org *.vercel.app https://vercel.live https://vercel.com blob: https://*.vercel-storage.com https://www.googletagmanager.com https://www.google-analytics.com use.typekit.net https://vercel.live https://verify.walletconnect.com https://verify.walletconnect.org https://www.google.com https://www.gstatic.com https://api.web3modal.org/appkit/v1/config;
    worker-src 'self' blob:;
    style-src 'self' 'unsafe-inline' p.typekit.net use.typekit.net https://vercel.live/fonts https://fonts.googleapis.com;
    style-src-elem 'self' 'unsafe-inline' https://p.typekit.net https://fonts.googleapis.com;
    connect-src 'self' https://api.telx.network https://mainnet.base.org https://*.datadoghq.com https://*.datadoghq.eu https://*.browser-intake-datadoghq.com https://browser-intake-datadoghq.com  https://polygon-rpc.com https://rpc.telx.network https://rpc.adiri.tel https://adiri.tel https://explorer-api.walletconnect.com wss://relay.walletconnect.com wss://www.walletconnect.com wss://www.walletlink.org wss://relay.walletconnect.org https://vercel.live https://vercel.com https://sockjs-mt1.pusher.com wss://ws-mt1.pusher.com https://*.vercel-storage.com https://*.kv.vercel-storage.com https://vitals.vercel-insights.com https://www.google-analytics.com https://region1.google-analytics.com wss://ws-us3.pusher.com https://sockjs-us3.pusher.com https://pulse.walletconnect.org https://*.vercel-storage.com https://*.kv.vercel-storage.com https://vitals.vercel-insights.com https://www.google-analytics.com https://enhanced-provider.rainbow.me https://api.ipify.org https://cca-lite.coinbase.com/metrics https://api.web3modal.org/appkit/v1/config
    https://cca-lite.coinbase.com/amp
    https://rpc.adiri.tel
    https://adiri.tel
    https://explorer-api.walletconnect.com
    wss://relay.walletconnect.com
    wss://www.walletconnect.com
    wss://www.walletlink.org
    wss://relay.walletconnect.org
    https://api.web3modal.org
    https://pulse.walletconnect.org
    https://enhanced-provider.rainbow.me
    https://vercel.live
    https://vercel.com
    https://sockjs-mt1.pusher.com
    wss://ws-mt1.pusher.com
    https://*.vercel-storage.com
    https://*.kv.vercel-storage.com
    https://vitals.vercel-insights.com
    https://www.google-analytics.com
    https://region1.google-analytics.com
    wss://ws-us3.pusher.com
    https://sockjs-us3.pusher.com;
    frame-src 'self' https://vercel.live https://vercel.com https://verify.walletconnect.org https://verify.walletconnect.com https://www.google.com https://www.gstatic.com;
    frame-ancestors 'self' https://verify.walletconnect.org https://telx.network;
    font-src 'self' data: https://use.typekit.net https://fonts.gstatic.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    upgrade-insecure-requests;
  `;

  const csp = cspHeader.replace(/\s{2,}/g, " ").trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("Access-Control-Allow-Origin", "https://telx.network");
  requestHeaders.set("X-Content-Type-Options", "nosniff");
  requestHeaders.set("X-Frame-Options", "DENY");
  requestHeaders.set("X-XSS-Protection", "0");
  requestHeaders.set("Referrer-Policy", "strict-origin");
  requestHeaders.set("Permissions-Policy", "autoplay=*");

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Access-Control-Allow-Origin", "https://telx.network");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set("Referrer-Policy", "strict-origin");
  response.headers.set("Permissions-Policy", "autoplay=*");

  if (request.nextUrl.pathname === "/install.html") {
    response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline';");
  }

  if (previewCookie) {
    response.cookies.set(PREVIEW_AUTH_COOKIE, previewCookie, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: PREVIEW_AUTH_COOKIE_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // The RPC proxy uses our Alchemy key, so preview Basic auth must cover it.
    { source: "/api/rpc/:path*" },
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
