---
id: 14
category: FAQs
order: 14
title: How do I provide liquidity?
---

## How do I provide liquidity?

First, you'll need to review which mining opportunities exist on TELx. All active TELx pools can be found on the [pools](/pools) page.

The pools page should look something like this:

![pools_page_1.jpg](/aboutMedia/pools_page_1.jpg)

Notice there are five pools on Polygon and one on Base. Depending on which chain your assets are located on, and which pool you would like to provide liquidity to, you may need to bridge. Check out how to bridge your assets [here](/about/how-do-i-bridge-to-polygon-pos-chain).

Assuming your assets are on the correct chain, the liquidity providing process differs slightly based on the underlying protocol.

For example, the TEL/ WBTC pool is a Balancer pool. The USDC/ eMXN pool is a Uniswap pool. 

Below, you will find walkthroughs demonstrating how to provide liquidity to each type of AMM.

### **Balancer**

1\. Select the pool from the pools page. You will be taken to the specific pool page, for example the USDC/ TEL pool:
![telx_balancer_pool.jpg](/aboutMedia/telx_balancer_pool.jpg)
2\. Next click 'Add Liquidity On Balancer' towards the top right of the page. You will be taken to the corresponding pool page on the Balancer site, for example:
![balancer_1.jpg](/aboutMedia/balancer_1.jpg)
3\. Click 'Add Liquidity'. A pop up should appear enabling you to add the desired tokens:
![balancer_add_liquidity.jpg](/aboutMedia/balancer_add_liquidity.jpg)
 Note: at this point it is recommended to select the 'Proportional' option, which will calculate one of your token amounts for you based on current prices. This minimizes price impact during your addition of liquidity.
4\. Insert one of the token amounts you wish to provide as liquidity. If using the 'Proportional' option, the corresponding amoutn should auto populate. If using the 'Flexible' amount, enter the number of corresponding tokens.
5\. Click 'I accept the risks of interacting with this pool' followed by 'Next'.
6\. Sign the following transactions (up to 3 depending on existing token allowances)
7\. Once these transactions are confirmed, you are an LP on Balancer!

### Uniswap

1\. Select the pool from the pools page. You will be taken to the specific pool page, for example the USDC/ eMXN pool:
![usdc_emxn_pool_page.jpg](/aboutMedia/usdc_emxn_pool_page.png)
2\. Click 'Add Liquidity On Uniswap' towards the top right corner of the page. You will be taken to the Uniswap site with the pool information pre loaded for you:

![usdc_emxn_uni_page.png](/aboutMedia/usdc_emxn_uni_page.png)

3\. Click 'Continue'. You will be taken to the following screen. Note: the TELx hook has been audited by Cantina. 
![usdc_emxn_uni_warning.png](/aboutMedia/usdc_emxn_uni_warning.png)
Select 'I understand the potetntial risks involved in adding the hook', followed by 'Continue'.

4\. You should reach a page like this:
![usdc_emxn_add_liquidity.png](/aboutMedia/usdc_emxn_add_liquidity.jpg)
Select your liquidity range. For a brief introduction on providing liquidity to concentrated liquidity pools, see this guide [here](/about/what-are-automated-market-makers?)
5\. Scroll down and input the number of tokens you wish to provide as liquidity.
6\. Click 'Review'.
7\. Click 'Create'.
8\. Sign the transaction using your wallet.
9\. You are now an LP on Uniswap!

In the next step, we will [walk through](/about/how-do-i-stake-my-liquidity) how you can begin mining [TELx incentives](/about/telx-market-participants-&-incentives) with your LP tokens.
