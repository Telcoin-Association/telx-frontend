/**
 * ABIs transcribed from `tdab-stablecoin/src/interfaces/IPSV.sol`, `src/psv/PegStabilityVault.sol`,
 * `src/Stablecoin.sol` with its `helpers/Blacklist.sol`, OpenZeppelin 5.5.0 (the version the vault is built with)
 * and the canonical Multicall3. Only the surface the vault page uses is included.
 */

// eUSD reverts that bubble up through a vault swap. OpenZeppelin 5.5's SafeERC20 re-raises the token's own revert
// data, so `sellGem`/`buyGem` can fail with these as well as with the vault's errors. eUSD checks the caller, `from`
// and `to` on every transfer, so `Blacklisted` can name the wallet or the vault.
const eusdTransferErrors = [
  { type: "error", name: "Blacklisted", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "EnforcedPause", inputs: [] },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as const;

export const vaultAbi = [
  { type: "function", name: "STABLE", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "GEM", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "stableReserve", type: "uint256" },
      { name: "gemReserve", type: "uint256" },
    ],
  },
  // Caps are WAD (18 decimals) on the input amount, whatever the token's decimals; 0 means no limit.
  {
    type: "function",
    name: "maxPerTransaction",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "maxPerBlock", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  // Fee rates in WAD (1e18 = 100%, at most 0.1e18). `tin` applies to buyGem (eUSD in), `tout` to sellGem (USDC in).
  { type: "function", name: "tin", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "tout", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  // The previews take (amount, recipient); the swaps take (recipient, amount).
  {
    type: "function",
    name: "previewSellGem",
    stateMutability: "view",
    inputs: [
      { name: "amountInGem", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [
      { name: "amountOutStable", type: "uint256" },
      { name: "feeStable", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "previewBuyGem",
    stateMutability: "view",
    inputs: [
      { name: "amountInStable", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [
      { name: "amountOutGem", type: "uint256" },
      { name: "feeGem", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "sellGem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amountInGem", type: "uint256" },
    ],
    outputs: [{ name: "amountOutStable", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyGem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amountInStable", type: "uint256" },
    ],
    outputs: [{ name: "amountOutGem", type: "uint256" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: false },
      { name: "tokenOut", type: "address", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "ZeroAmount", inputs: [] },
  // A zero recipient; the page always sends the connected wallet.
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InsufficientReserves", inputs: [] },
  { type: "error", name: "ExceedsTransactionLimit", inputs: [] },
  { type: "error", name: "ExceedsBlockLimit", inputs: [] },
  // Only when a token call returns false or the token has no code; a token that reverts re-raises its own error.
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  // EnforcedPause is the vault's and eUSD's (same selector).
  ...eusdTransferErrors,
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  // eUSD's pause gates transfers, mints and burns, not `approve`.
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  ...eusdTransferErrors,
] as const;

export const multicall3Abi = [
  // Payable on chain. Declared `view`, as viem's own copy is, so `readContract` accepts it; the selector is the same.
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "view",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getChainId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "chainid", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBlockNumber",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "blockNumber", type: "uint256" }],
  },
] as const;
