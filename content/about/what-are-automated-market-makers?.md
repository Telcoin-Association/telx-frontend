---
id: 11
category: FAQs
order: 11
title: What are Automated Market Makers?
---

### **Automated Market Makers (AMMs) Explained**
Excerpts from the St. Louis Federal Reserve's ["Decentralized Finance: On Blockchain- and Smart-Based Financial Markets"](https://research.stlouisfed.org/publications/review/2021/02/05/decentralized-finance-on-blockchain-and-smart-contract-based-financial-markets?utm_source=twitter&utm_medium=SM&utm_content=stlouisfed&utm_campaign=ad262f32-ffcb-423a-ae3b-acd7e4d3caf7) by Fabian Schär.

#### **What are AMMs?**
Unlike traditional orderbook-based exchanges, where buyers and sellers cross the bid-ask spread to execute trades and determine asset prices, AMMs are a type of decentralized exchange composed of “smart contract-liquidity pools that hold (at least) two crypto assets in reserve and allow anyone to deposit tokens of one type and thereby to withdraw tokens of the other type (aka a 'swap')."
There are two main AMMs used in TELx markets: Constant product AMMs (for example Uniswap V2 and Balancer V2 pools), and Concentrated liquidity AMMs (Uniswap V3 and Uniswap V4)

#### **Constant Product AMMs (Uniswap V2, Balancer V2)**

##### **Incentives**
Traders pay a fixed fee to the liquidity pool on every trade, and liquidity providers earn a proportional amount of fee revenue based on how much of the pool they own.

![TELCOIN_WALLET_UX__-_Copy_of_TEL_ETH_UNI.png](/aboutMedia/TELCOIN_WALLET_UX_Copy_of_TEL_ETH_UNI_d36cf7ff91.png)

##### **Pricing**
To determine the exchange rate, smart contract-based liquidity pools use variations of the constant product model, where the relative price is a function of the smart contract's token reserve ratio.

![AMM_Fabian.jpg](/aboutMedia/AMM_Fabian_0763c9758e.jpg)

Figure 1: Visualization of liquidity pool token reserves in a constant product model.

In its simplest form, the constant product model can be expressed as *x* * *y* = k, where *x* and *y* correspond to the smart contract's token reserves and k is a constant. Considering that this equation must hold, when someone executes a trade, we get (*x* + Δ*x*) · (*y* + Δ*y*) = *k*. It can then be easily shown that Δy = (*k*/*x* + Δ*x*) – *y*. Consequently, Δ*y* will assume negative values for any Δ*x* > 0. In fact, any exchange corresponds to a move on a convex token reserve curve, which is shown in Figure 1. A liquidity pool using this model cannot be depleted, as tokens will get more expensive with lower reserves. When the token supply of either one of the two tokens approaches zero, its relative price rises infinitely as a result.

It is important to point out that smart contract-based liquidity pools are not reliant on external price feeds (so-called “oracles”). Whenever the market price of an asset shifts, anyone can use the arbitrage opportunity and trade tokens with the smart contract until the liquidity pool price converges to the current market price. The implicit bid/ask spread of the constant product model (plus a small trading fee) may lead to the accumulation of additional funds. Anyone who provides liquidity to the pool receives pool share tokens that allow them to participate in this accumulation and to redeem these tokens for their share of a potentially growing liquidity pool. Liquidity provision results in a growing *k* and is visualized in Figure 1.

(Thank you to Fabian Schär for such an intuitive overview, read [his article](https://doi.org/10.20955/r.103.153-74) to learn more about AMMs and decentralized financial markets.)

Watch the following video by [Finematics](https://twitter.com/finematics?s=20) to learn more about liquidity pools and how they work:

[![Video](https://www.youtube.com/embed/cizLhxSKrAc)](https://www.youtube.com/embed/cizLhxSKrAc)

#### **Concentrated Liquidity AMMs**

Concentrated liquidity AMMs are a relatively new development and an improvement on Concentrated Liquidity AMMs. They were introduced by Uniswap with their V3 protocol, and further developed in their V4 protocol.

The key development of concentrated liquidity pools (V3/V4) relative to constant product (V2) pools is how liquidity is managed. Whereas in V2 pools, any liquidity added to the pool is spread across the full range of the liquidity curve, V3 allows users to specify distinct price ranges in which to provide liqudity.
To achieve this, the price curve is split into a number of of segments which are bounded by 'ticks' or certain price points. This discretises the price curve and allows different price ranges to hold different amounts of liquidity. Within each price range the curve still obeys the constant product formula, meaning we can continue to use much of the logic from the Constant Product case. For example, the amount of liquidity within a tick range is still proportional to the distance of the curve from the origin. 

![v2_vs_v3.jpeg](/aboutMedia/v2_vs_v3.jpeg)

Figure 2: Visualization of V2 (left) and V3 (right) price curves. [https://rareskills.io/post/uniswap-v3-concentrated-liquidity](https://rareskills.io/post/uniswap-v3-concentrated-liquidity)

Figure 2 compares the price curves for a V2 pool (on the left) and a V3 pool on the right. Notice how the V3 pool is discretised, with different liquidity amounts on different areas of the curve. While the V3 curve looks discontinuous, it is actually used in a continuous manner during swaps, as the liquidity in one tick range is used up before moving to the next tick range (which may have a different amount of liquidity).

Another way of demonstrating this is by plotting liquidity against price, as shown in Figure 3.

![v3_liquidity_map.jpg](/aboutMedia/v3_liquidity_map.jpg)
Figure 3: V3 liquidity plots. [https://rareskills.io/post/uniswap-v3-concentrated-liquidity](https://rareskills.io/post/uniswap-v3-concentrated-liquidity)

Figure 3 shows how liquidity is used between tick ranges. At the point in the image, the price is at the higher tick of the yellow tick range. This is seen by the poisition of the red dot on the right side plot. If users interacting with the pool continue to swap y tokens for x tokens, x tokens become more scarce in the pool relative to the number of y tokens, symbolising a rise in the price of token x. The red line on the left plot will turn anti-clockwise while the red dot on the right plot will move to the right, into the purple liquidity region. Since the purple tick range has a lower liquidity than the yellow (as the curve on the left is nearer the origin and the bar on the right is shorter), trades of a given size will have higher price impact - that is they will move the price by a higher percentage - than when the price was trading in the yellow tick range. 

It is also important to note that if each liquidity provider were to provide their liquidity in the full  price range (0 to infinity), the V3 pool woul dbehave exactly the same as a V2 pool with the same assets and same amount of liquidity.

[Rareskills](https://rareskills.io/) have a great explainer on concertrated liquidity [here](https://rareskills.io/post/uniswap-v3-concentrated-liquidity) which was the source of these images. Read their article for more insight on how concentrated liquidity works.

Overall, the main advantage V3 pools have over V2 pools is the ability to provide liquidity predominantly in the areas of the price curve that are most likely to be used, and liquidity does not need to be distributed evenly between prices of 0 and infinity. This means, that for a given amount of liquidity, V3 pools can often provide lower price impacts for swaps, making swaps cheaper for the end user. 

##### **Fees**
While in V2 pools, all trading fees are shared pro rata between liquidity providers based on the amount of liquidity each provides, fees distributed in V3 pools are dependent on the price range over which liquidity is provided. When a swap is executed, fees are paid only to those liquidity providers who are providing liquidity within the price range the swap occurs over. 

##### **Other Considerations**
If market prices move outside a liquidity provider's specified price range, their liquidity is effectively removed from the pool and is no longer earning fees. In this state, an LP's liquidity is composed entirely of the less valuable of the two assets, until the market price moves back into their specified price range or they decide to update their range to account for current prices.

##### **Uniswap V4**
Uniswap V4 also uses concentrated liqudity, but brought improvements in gas efficiency and the customizability of pools through hooks - additional logic that can be invoked during interactions with the pool. Within the TELx ecosystem it is fair for liquidity providers to consider V4 pools as general concentrated liquidity pools, with some additional considerations surrounding incentives, which are covered [here]()  

#### **Benefits to AMMs: Why is Telcoin building our first suite of products on AMMs?**
**User-owned Exchange Products:** Our first two products, a global, user-owned remittance network, and a user-owned, decentralized token exchange are both uniquely made possible by AMMs. By enabling users to provide self-custodial liquidity to markets that power products they rely on in their daily lives, Telcoin users effectively pay themselves instead of instead of exchanges, FX providers, the interbank market, banks, brokers, professional market makers, and other legacy middlemen. In other words, we want you to **PAY YOURSELF!**

**Self-custodial:** Users custody their own assets at all times and can remove their liquidity whenever they would like.

**Decentralized and automated:** There are no intermediaries or middlemen who host order books, match orders, settle transactions, or custody assets. Execution, settlement, and delivery are automated via smart contracts 24-7-365.

**Battle-tested:** AMMs power of dollars of trading volume every day with nearly USD$700B worth of volume over the past two years.

**Guaranteed liquidity at every price level:** When you provide liquidity to constant product market makers like Quickswap, you guarantee liquidity at every price level, a key design objective for products that operate 24-7-365 and a major improvement over order-book based, manual market making exchanges that are high-touch, active exchange systems. Contrast AMMs with legacy financial exchange mishaps, such as the [Gamestop](https://www.washingtonpost.com/business/2021/02/18/gamestop-robinhood-citadel-roaring-kitty-hearing-live-updates/) Robinhood incident, where the institutional intermediaries responsible for retail order flow allegedly shut down trading for their customers, and it’s easy to see how these systems appeal to retail consumers.

**Permissionless:** Anyone can build on, launch markets, and participate in both the supply side and demand side of AMMs, enabling global pools of demand and liquidity to converge on open, decentralized marketplaces, 24/7/365, without the need for intermediaries or middlemen to function.

#### AMM Risks Disclaimer
Providing liquidity is risky. When you pool your assets, you expose yourself to the risk profile of those assets and the contract risk of the protocol you are supplying. The other major risk, impermanent loss, is explained eloquently in [this video](https://youtu.be/8XJ1MSTEuU0) by [Finematics](https://twitter.com/finematics?s=20) and which you can simulate [here](https://baller.mechanaut.xyz/).

Telcoin offers no advice or recommendations, and has no responsibility over assets, including TEL, you decide to hold, pool, swap or use in any way.

TEL is a decentralized utility token designed to be used in a variety of ways for consumptive and productive purposes. Telcoin does not control the usage of TEL by any users. TEL is not an investment in any way, it is meant to be used. Telcoin literature or announcements should not be considered an investment contract or call to action.

This overview in no way serves as a solicitation to buy, sell, swap, pool, stake or use any assets mentioned.

When you pool, you expose yourself to volatility risk, and may end up with less TEL or value than you initially deposited. Telcoin has no control over TEL or any other assets on any marketplace.

Smart contracts are susceptible to bugs and Telcoin is in no way affiliated with the development of any DeFi protocol. You are solely responsible for your decisions you make with your assets, and should take great care to properly complete due diligence and consult with registered financial professionals where you personally deem fit.
