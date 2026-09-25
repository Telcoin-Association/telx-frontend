# Contributing to telx.network

This repository holds the frontend for [telx.network](https://telx.network), the TELx liquidity-provider dashboard. It is a Next.js App Router application that reads pool, position, and reward data for TEL liquidity across Uniswap v4, Balancer, QuickSwap, and DFX on Polygon and Base.

Outside contributions are welcome. This guide covers how to get the app running, what checks to pass before you open a pull request, and which parts of the repo are known to be rough.

## Code of conduct

This project follows the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Report violations to [devs@telcoin.org](mailto:devs@telcoin.org).

## Getting set up

You need Node 20 or newer and npm. The repo has a `package-lock.json`, so use `npm ci` rather than `npm install` for a reproducible install.

```sh
npm ci
cp .env.sample .env.local
# set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (see below), then:
npm run dev
```

The dev server runs on http://localhost:3000.

### About the credentials

One variable is mandatory. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` must have a value or nothing works: RainbowKit throws `No projectId found` while building the wagmi config, which every page imports. With it blank, `npm run dev` returns HTTP 500 on every route and `npm run build` fails during prerendering. Get a free project ID from [Reown Cloud](https://cloud.reown.com/), formerly WalletConnect Cloud.

Every other variable is optional and only affects which data loads. Three are private Telcoin credentials that outside contributors will not have: `TELX_BACKEND_SECRET_KEY`, `TELCOIN_API_KEY`, and `UNISWAP_API_KEY`. `NEXT_PUBLIC_ALCHEMY_ID` takes your own free [Alchemy](https://www.alchemy.com/) key.

`PREVIEW_BASIC_AUTH` is optional too. When set to `user:password` it password-protects the whole site with HTTP Basic auth. We set it in Vercel for the Preview environment, scoped to the branch we share with stakeholders, so other PR previews stay open, and leave it empty everywhere else. After one successful login the browser is remembered by a cookie for 30 days on that hostname, and rotating the password logs everyone out.

With only the WalletConnect project ID set, `npm run build` succeeds and every route serves normally in dev. These surfaces are fully workable:

- every page renders, including layout, styling, navigation, and routing
- all component and Tailwind work
- the About section, which is served from the markdown files in `content/about/`
- wallet connection

These will fail or render empty without the remaining keys:

- pool listings and pool detail pages, which read through the route handlers under `src/app/api/backend/subgraphs/`
- the portfolio page and Uniswap position lookups, which need both the Alchemy key and `UNISWAP_API_KEY`
- market rates on `/api/market-rate`, which needs `TELCOIN_API_KEY`

If your change touches one of the data-dependent surfaces and you cannot run it end to end, say so in the pull request. A maintainer will verify it against a live backend.

## Checks to run before opening a pull request

There is no CI. This repo has no `.github/` directory and nothing runs automatically when you open a pull request, so these are on you:

```sh
npm run lint            # next lint
npm run security-check  # scripts/security-check.js
npm run build           # runs security-check first, via prebuild
```

`npm run build` is the check that matters most. It type-checks the whole project and will catch most breakage that lint misses.

`npm run security-check` scans `package.json` and `package-lock.json` against a pinned list of package versions compromised in the September 2025 npm supply-chain attack on `chalk`, `debug`, `ansi-styles`, and their transitive dependencies. It is wired to `prebuild`, so a build fails outright if a compromised version appears in the tree. If you add or bump a dependency and the build stops here, do not work around it. Find a version that is not on the list.

## Known gaps

These are real and unfixed. Knowing about them up front will save you time.

There are no tests. Jest is configured in `jest.config.ts` and `npm test` exists, but the repo contains zero test files, and `jest.setup.ts` imports `@testing-library/jest-dom/extend-expect`, a path that was removed in jest-dom v6. Running `npm test` will not give you anything useful today. New tests are welcome, but expect to fix that import first.

Prettier is configured but not installed. `prettier.config.js` exists and is checked in, yet `prettier` is not in `package.json`, its `prettier-plugin-tailwindcss` plugin is not installed, and it points `tailwindConfig` at `./tailwind.config.ts`, which does not exist because this project uses Tailwind v4's CSS-first configuration. Do not run Prettier expecting it to match the repo. Match the formatting of the file you are editing instead.

Lint is permissive. `eslint.config.mjs` turns off `@typescript-eslint/no-explicit-any`, `no-unused-vars`, and `no-unused-expressions`, so a clean lint run says less than it looks like it does. Also, `next lint` is deprecated as of Next 15.5 and will be removed in Next 16; it still works for now.

## Project structure

```
src/
  app/           Next.js App Router: pages, layouts, and API route handlers
    api/         server-side route handlers that proxy the TELx backend and chain data
  components/    React components
  data/          static data and constants
  helpers/       formatting and calculation utilities
  hooks/         React hooks
  lib/           wagmi/viem clients, contract config, Alchemy SDK setup
  redux/         Redux Toolkit store and slices
  types/         shared TypeScript types
  web3/          ABIs, contract getters, and transaction builders
  middleware.ts  security headers and CSP
content/about/   markdown source for the About section
public/          static assets
scripts/         security-check.js
```

## Branches and commits

Branch off `main` and name your branch by what it does. The prefixes in use are `feat/`, `fix/`, `perf/`, and `chore/`, as in `feat/merkl` or `perf/subgraph-apis`.

Open your pull request against `main`. Maintainers may retarget it to `staging`, which is where changes are staged before release.

Write commit messages in the imperative and say what changed: "cache token prices in the pool list" rather than "changes" or "wip". There is no conventional-commits requirement.

In the pull request description, list the high-level changes and note anything you could not verify locally.

## Adding dependencies

Keep `package-lock.json` in sync with `package.json` and commit both. `security-check.js` hard-fails the build on known-compromised versions, so run `npm run build` after any dependency change.

## Security

Never commit `.env.local` or any real credential. `.gitignore` covers `.env*`, and `.env.sample` is checked in with empty values only. Keep it that way.

Do not report a vulnerability in a public issue. See [SECURITY.md](SECURITY.md) for how to report one privately.

## License

By contributing, you agree that your contributions are dual-licensed under the Apache License 2.0 and the MIT License, matching the license of this repository. See [LICENSE-APACHE](LICENSE-APACHE) and [LICENSE-MIT](LICENSE-MIT).
