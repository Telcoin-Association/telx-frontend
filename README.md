# www.telx.network

This repository holds the frontend for [www.telx.network](https://www.telx.network), the TELx liquidity-provider dashboard. It shows pool, position, and reward data for TEL liquidity across Uniswap v4, Balancer, QuickSwap, and DFX on Polygon and Base.

Production: [https://telx.network](https://telx.network)

## Stack

The app is built with Next.js (App Router) and React, written in TypeScript, and styled with Tailwind CSS v4. Wallet connection and chain reads go through wagmi, viem, and RainbowKit. Editorial content is delivered from Contentful, and the About section is served from markdown in `content/about/`.

## Getting started

You need Node 20 or newer and npm.

```sh
npm ci
cp .env.sample .env.local
# set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, then:
npm run dev
```

The dev server runs on http://localhost:3000.

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is required, and a free one from [Reown Cloud](https://cloud.reown.com/) works. Every other variable is optional and only affects which data loads. See [CONTRIBUTING.md](CONTRIBUTING.md) for which parts of the site work without the private Telcoin credentials and which do not.

## Scripts

```sh
npm run dev             # dev server
npm run build           # production build (runs security-check first)
npm run start           # serve a production build
npm run lint            # eslint via next lint
npm run security-check  # scan dependencies for known-compromised versions
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup details, the checks to run before opening a pull request, and the known rough edges in this repo.

To report a security vulnerability, see [SECURITY.md](SECURITY.md). Do not open a public issue for one.

## License

Dual-licensed under the Apache License 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) and the MIT License ([LICENSE-MIT](LICENSE-MIT)), at your option.

## Links

- [Next.js](https://nextjs.org)
- [React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [wagmi](https://wagmi.sh) and [viem](https://viem.sh)
- [RainbowKit](https://www.rainbowkit.com)
- [Contentful](https://www.contentful.com)
