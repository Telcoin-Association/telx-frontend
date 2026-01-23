---
id: 17
category: FAQs
order: 17
title: What is Balancer?
---

![What_is_Balancer_Hero.png](/aboutMedia/What_is_Balancer_Hero_281e469c13.png)

## Balancer Protocol Overview
Balancer is an automated portfolio manager, liquidity provider, and price sensor. It is a non-custodial, Ethereum and polygon based automated market maker (AMM) that enables anyone to create or add liquidity to fully programmable, customizable pools and earn trading fees or swap assets.

Balancer turns the concept of an index fund on its head. Instead of paying fees to portfolio managers to rebalance your portfolio, you collect fees from traders, who rebalance your portfolio by following arbitrage opportunities.

## Balancer AMM curve and pricing
Balancer is based on an [N-dimensional invariant surface](https://balancer.finance/whitepaper/), which is a generalization of the constant product formula described by Vitalik Buterin and proven viable by the popular Uniswap dapp. 

Many existing AMMs, such as Uniswap, use a constant product (x*y=k) formula for pricing. Balancer generalizes this using a constant mean formula, enabling any number of fully customizable pools:

![Balancer_Weighted_Geometric_Mean.png](/aboutMedia/Balancer_Weighted_Geometric_Mean_8cc76dfa6d.png)

![Visualization of the Balancer Curve](/aboutMedia/Balancer_Weighted_Geometric_Mean.png)
*Visualization of the Balancer Curve*

## Telcoin and Balancer
Telcoin first began building on Balancer in Q3 of 2020, which included a liquidity mining pilot program on the [TEL/ETH Balancer V1 80:20 pool](https://pools.balancer.exchange/#/pool/0x6cb5c5cb789fae62ce5ce280e1fbc5dd3bbdad81/shares), lasting a total of [eight months](https://docs.google.com/spreadsheets/d/1HS9Wc_y1uU1By8f6uPKn8Rhnlk6y7NzlkfMddklqJSU/edit?usp=sharing).

## Why Balancer?
- **Programmable:** Pools can be coded for an unlimited number of use cases.
- **Customizable:** Pool token weights, asset composition, and trading fees can be customized by the pool creator. This leads to a number of benefits including:
  - **Impermanent Loss Reduction:** Whereas a 50/50 pool will have an impermanent loss of 25 percent if one of the underlying pool assets 5x’s in value, a Balancer 80/20 will capture 83.86% percent of the upside of the move (not including liquidity mining rewards or trading fees). On the flip side, a 50/50 pool with the same liquidity and trading fees will also have less slippage than a 80/20 pool.

![Balancer_Impermanent_Loss_Curve.png](/aboutMedia/Balancer_Impermanent_Loss_Curve_f87111807b.png)
    *Balancer Impermanent Loss Reduction Curve*
    
- **Aggregation:** By introducing more than one pool for each supported asset on TELx, Telcoin user trades can aggregate across multiple sources, achieving best execution. Balancer’s front end uses a Smart Order Router (SOR) to find optimal trades, enabling efficient price discovery and balanced markets.
- **Permissionless:** Anyone with an internet connection can access Balancer, thus boosting financial inclusion - one of Telcoin’s core missions.
- **Efficient:** Balancer is a self-sustaining asset manager and decentralized exchange powered by code, not humans/middlemen. This also means there are no listing fees.
- **Automated:** Unlike traditional orderbook exchanges, market making, trade execution, clearing and settlement, and trading fee distribution on Balancer is automated on chain. Balancer does all of the work for you.
- **Self-custodial:** There is no need to trust a centralized third-party to custody funds or validate transactions - you keep control of your assets. This significantly reduces counter-party risk and enables fluid on chain transaction utility without relying on any financial intermediaries.
- **Composable:** Balancer can be combined with different protocols and applications to create new financial products and services. Balancer will serve as a key infrastructure layer of the Telcoin platform.
- **User-owned:** Suppliers (Liquidity Providers or LPs) earn the native governance token of Balancer, BAL, for providing liquidity to the platform, and directly vote on protocol updates, changes, and initiatives to improve it.
- **Open Source:** Anyone can develop on or modify the code.
- **Transparent:** Ethereum is completely transparent and auditable. 


According to the following excerpt from the Balancer Protocol developer team, 80/20 pools are dubbed the “[Golden Standard](https://medium.com/balancer-protocol/liquidity-after-bootstrapping-ffc7856d5c8e)” for providing an optimal strategy for capturing token price appreciation, trading fees/liquidity mining incentives, and token market/ecosystem growth:

#### [**Aligned Incentives**](https://medium.com/balancer-protocol/liquidity-after-bootstrapping-ffc7856d5c8e)
*Providing liquidity to a pool that is unevenly split 80/20 more accurately expresses bullish conviction in a newly-launched token - it is closer to mirroring classic holding but also carries LP benefits.*

*From the community’s perspective, investing part of their $TKN into an 80/20 pool can be seen as an optimal investment strategy, since they would benefit from all three things:*
1. *Token price appreciation*
2. *Trading fees/liquidity mining incentives*
3. *Token market/ecosystem growth*

*As a TKN holder*, providing liquidity with part of one’s $TKN assets can be seen as a hedge against both prolonged price stagnation periods and price drops.*

![Balancer_Impermanent_Loss_Curve.png](/aboutMedia/Balancer_Impermanent_Loss_Curve_f87111807b.png)

*In the scenario of stagnating price, holders* “benefit from passive pool income, and in the massive price drop scenario — they stand to ([impermanently](https://medium.com/balancer-protocol/80-20-balancer-pools-ad7fed816c8d)) lose a bit less compared to a 50/50 pool. Because of this, pure holders don’t perform that much better than 80/20 LPs — especially during bear markets.*

*Additionally, simply holding* is not constructive to the project’s longevity as it equates to refraining from helping to build a liquid market for the token. Holding is a sort of standoff event, where the token’s total liquidity is impaired by a lack of liquidity provision.*

*Low liquidity leads to stagnation of trading activity and token value, as investors and contributors are less interested in participating. The opposite — active LPing by a large number of community members — stands to spin up a positive network effect which leads to greater aggregate liquidity and therefore market growth.”*

*holder was originally HODLer, a colloquial term crypto-natives use to describe investors-at-any-price*

*Source: [Liquidity After Bootstrapping The 80/20 standard for incentivizing continuous token liquidity](https://medium.com/balancer-protocol/liquidity-after-bootstrapping-ffc7856d5c8e) by Balancer Labs*

## Learn More
See the following links to learn more about Balancer:

### Main links
- Website: [https://balancer.fi/](https://balancer.fi/)
- Documentation: [https://docs.balancer.fi/](https://docs.balancer.fi/)
- Polygon Interface: [https://polygon.balancer.fi/#/](https://polygon.balancer.fi/#/)
- Github: [https://github.com/balancer-labs/](https://github.com/balancer-labs/)

### Socials and community
- Twitter: [https://twitter.com/balancerlabs?s=21](https://twitter.com/balancerlabs?s=21)
- Medium: [https://medium.com/balancer-protocol](https://medium.com/balancer-protocol)
- Discord: [https://discord.com/invite/ARJWaeF](https://discord.com/invite/ARJWaeF)
