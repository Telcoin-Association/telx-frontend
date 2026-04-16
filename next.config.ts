import type { NextConfig } from "next";

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
