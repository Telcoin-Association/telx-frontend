---
id: 13
category: FAQs
order: 13
title: How do I bridge to Polygon POS Chain?
---

## Bridging to Polygon PoS

In order to participate as a liquidity miner on some TELx pools, you will first need to bridge your assets to Polygon PoS Chain. Follow the step-by-step guide below to learn how.

Note: you **must have ETH in your Metamask wallet to cover gas fees** associated with bridging to Polygon. You will then also require POL tokens on Polygon for gas once your TEL tokens are on the Polygon network. It is recommended you deposit POL tokens to your wallet from a centralized exchange or from Ethereum (using the bridge) prior to bridging your TEL. Notes for bridging POL will be included in the steps below.

## Using the Polygon Portal

Polygon (formerly Matic) uses a “bridge” to move assets from the Ethereum Mainnet to Polygon’s Proof of Stake Chain, accessible via a dedicated wallet that makes it easy to send digital assets from one network to the other.

## Deposit Tokens

To deposit tokens - that is, to transfer them from the Ethereum Mainnet to Polygon PoS - navigate to the [Polygon Portal](https://portal.polygon.technology/bridge). You will see this screen:

![bridge_1.jpg](/aboutMedia/bridge_1.jpg)

Click 'Connect wallet and bridge'. Select your preferred wallet provider from the list, and then connect your wallet (ensuring you connect the correct address, if applicable). Your page should look something like this:
![bridge_2.jpg](/aboutMedia/bridge_2.jpg)

Click on 'ETH' (below the 'Balance' input on the 'Transfer from' box). A list of tokens should appear. Type in 'TEL' or '0x467bccd9d29f223bce8043b84e8c8b282827790f' (the TEL token contract address on Ethereum) and select the token.

Note: if bridging POL, please select 'POL' instead at this point.

Input the amount to bridge and click the “Bridge TEL to Polygon POS” button. You will be prompted to sign an allowance transaction followed by the bridge transaction. Sign these using your wallet, after which you should see this pop up:


![bridge_4.jpg](/aboutMedia/bridge_4.jpg)

At the time of writing, the transfer takes approximately 22 minutes. The TEL will be sent directly to your wallet on Polygon.


## Withdraw Tokens

Withdrawing an asset uses the same bridge interface, but in reverse - from Polygon back to the Ethereum Mainnet.

Again, the Polygon bridge interface will guide you through the process. You will encounter a “checkpoint” approximately halfway through the withdrawal process, which must be approved to complete the transaction. While it only takes a few minutes to send assets to Polygon, sending them back over the bridge to Ethereum can take up to 3 hours.

## Token Transfers on Polygon

To sign transactions on Polygon, you will need to connect your wallet to the Polygon network. For Metamask, this is covered in the following guide: [Configuring Polygon on Metamask](https://docs.polygon.technology/tools/wallets/metamask/add-polygon-network/).
