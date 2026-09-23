# Security policy

This policy covers the frontend application in this repository and the site it serves at [telx.network](https://telx.network).

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues, pull requests, or discussions.**

Report privately through either channel:

1. GitHub private vulnerability reporting, which is preferred: [open a draft advisory](https://github.com/Telcoin-Association/telx-frontend/security/advisories/new). This keeps the report, the discussion, and the fix in one place, and lets us credit you when the advisory is published.
2. Email [security@telcoin.org](mailto:security@telcoin.org).

Please include:

- a description of the vulnerability
- steps to reproduce it
- the impact, and what an attacker gains
- technical details and a proof of concept if you have one
- the affected URL, route handler, or file path

## Response process

1. We acknowledge receipt of your report within 48 hours.
2. We provide an initial assessment within 5 business days.
3. We keep you informed as we investigate and fix the issue.
4. Once resolved, we notify you and agree on public disclosure timing with you.

## Scope

### In scope

- this Next.js application and the deployed site at telx.network
- the server-side route handlers under `src/app/api/`, including how they build upstream requests and handle credentials
- `src/middleware.ts`, the Content Security Policy, and the other security headers it sets
- client-side wallet integration and transaction construction under `src/web3/`
- dependency vulnerabilities reachable through this repository's `package-lock.json`

### Out of scope

Report these to whoever owns them, not here.

- the TELx backend at `api.telx.network`, which lives in a separate repository
- the Telcoin Network protocol and its smart contracts, which are separate repositories with their own security policies
- the DEX protocols this app reads from: Uniswap v4, Balancer, QuickSwap, and DFX. Report those upstream to each protocol.
- third-party services: Alchemy, WalletConnect, The Graph, Goldsky, Contentful, Vercel, and Datadog
- the reference Solidity under `src/web3/contractCode/`. It is kept for reference and is neither compiled nor deployed from this repository.
- user wallet software, browser extensions, and hardware wallets
- phishing sites, typosquatted domains, and impersonation accounts. Report those to [security@telcoin.org](mailto:security@telcoin.org) so we can pursue takedowns, but they are not vulnerabilities in this codebase.
- social engineering against Telcoin staff or community members
- volumetric denial of service and traffic flooding
- automated scanner output with no demonstrated impact, and theoretical findings with no proof of concept
- vulnerabilities already reported or already public

## Supported versions

telx.network is continuously deployed. There are no versioned or tagged releases, and older builds are not maintained or patched. Only the version currently deployed at telx.network is supported, and fixes ship to it directly.

## Security updates

Security fixes ship as soon as they are ready. There is no fixed release cadence.

## Disclosure policy

- All vulnerability reports and the communications around them are confidential.
- Please do not publicly disclose any details of the vulnerability without our written permission.
- We aim to fix critical vulnerabilities as quickly as possible.
- We may pre-disclose to partners where an issue affects them.

## Bug bounty

There is no formal bug bounty program at this time. If you want to ask about its status, email [security@telcoin.org](mailto:security@telcoin.org).

## Credits and acknowledgments

We thank the security researchers who disclose vulnerabilities responsibly. If you want credit for a valid report, tell us and we will name you in the advisory or arrange another acknowledgment.
