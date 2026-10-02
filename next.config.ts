import type { NextConfig } from "next";

// Content-Security-Policy for pages and the RPC proxy, written one directive per line and collapsed to a
// single line when the config loads.
const CONTENT_SECURITY_POLICY = `
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
`
  .replace(/\s{2,}/g, " ")
  .trim();

// Security headers sent with every page and with the RPC proxy. They are static, so Next.js applies them
// from the routes manifest with no per-request work. Framing is governed by the CSP frame-ancestors list alone:
// X-Frame-Options is not sent, because DENY would contradict that list. HSTS is not set here because Vercel
// already sends Strict-Transport-Security on the production domains.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Access-Control-Allow-Origin", value: "https://telx.network" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "strict-origin" },
  { key: "Permissions-Policy", value: "autoplay=*" },
];

const nextConfig: NextConfig = {
  images: {
    domains: [
      "images.ctfassets.net",
    ],
  },
  reactStrictMode: false,
  experimental: {
    useLightningcss: false,
  },
  async headers() {
    return [
      // Everything except API routes, Next.js build assets and the favicon.
      { source: "/:path((?!api/|_next/static|_next/image|favicon.ico).*)", headers: SECURITY_HEADERS },
      { source: "/api/rpc/:path*", headers: SECURITY_HEADERS },
      // A later entry wins for the same header key, so this narrower policy replaces the site CSP here.
      { source: "/install.html", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'unsafe-inline';" }] },
      // The unlinked wallet troubleshooting page is never indexed. It renders per request, so it isn't cached either.
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
  async redirects() {
    return [
      {
        source: "/about/telx-market-participants-&-incentives",
        destination: "/about/telx-market-participants-incentives",
        permanent: true,
      },
      {
        source: "/about/telx-ecosystem-assets-&-protocols",
        destination: "/about/telx-ecosystem-assets-protocols",
        permanent: true,
      },
    ];
  },
  webpack(config, { isServer }) {
    config.externals.push('pino-pretty')
    if (!isServer) {
      config.resolve.fallback = { fs: false, net: false, tls: false, '@react-native-async-storage/async-storage': false, };
    }
    // Also ignore optional native modules from metamask sdk
    config.externals = [...(config.externals || []), { '@react-native-async-storage/async-storage': 'commonjs @react-native-async-storage/async-storage' }];
    config.module.rules.push({
      test: /\.svg$/,
      use: [
        {
          loader: "@svgr/webpack",
          options: {
            dimensions: false,
          },
        },
      ],
      type: "javascript/auto",
      issuer: {
        and: [/\.(js|ts)x?$/],
      },
    });

    return config;
  },
};

export default nextConfig;
