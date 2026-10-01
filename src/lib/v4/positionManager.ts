import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";

/**
 * Calls to the Uniswap v4 PositionManager for adding liquidity, and the approvals they need. Liquidity changes go
 * through `modifyLiquidities(unlockData, deadline)`, where `unlockData` is `abi.encode(bytes actions, bytes[] params)`:
 * one action byte per step (v4-periphery `Actions`) and its parameters. Tokens are paid through Permit2, which the
 * PositionManager pulls from; native ETH (the zero address) is sent as the call's value, and any excess is swept
 * back to the owner.
 */

/** Permit2: one address on every chain. */
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** v4-periphery Actions used here. */
export const ACTIONS = { INCREASE_LIQUIDITY: 0x00, MINT_POSITION: 0x02, SETTLE_PAIR: 0x0d, SWEEP: 0x14 } as const;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export const positionManagerAbi = parseAbi([
  "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function subscribe(uint256 tokenId, address newSubscriber, bytes data) payable",
  "function nextTokenId() view returns (uint256)",
  "function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "error NotApproved(address caller)",
  "error DeadlinePassed(uint256 deadline)",
  "error AlreadySubscribed(uint256 tokenId, address subscriber)",
]);

export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getTickBitmap(bytes32 poolId, int16 tick) view returns (uint256 tickBitmap)",
  "function getTickLiquidity(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
]);

/** Uniswap's v4 StateView, which reads pool state from the PoolManager, by chain id. */
export const STATE_VIEW: Readonly<Record<number, Address>> = {
  1: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  137: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
  8453: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
};

export const MAX_UINT160 = 2n ** 160n - 1n;
export const MAX_UINT256 = 2n ** 256n - 1n;

/** The PositionManager keys pools by the first 25 bytes of the pool id. */
export const poolKeyId = (poolId: Hex): Hex => poolId.slice(0, 2 + 50) as Hex;

export const isNative = (currency: Address) => currency.toLowerCase() === zeroAddress;

const POOL_KEY = "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";

const encodeUnlock = (actions: number[], params: Hex[]): Hex =>
  encodeAbiParameters(parseAbiParameters("bytes actions, bytes[] params"), [
    `0x${actions.map((action) => action.toString(16).padStart(2, "0")).join("")}`,
    params,
  ]);

const settlePairParams = (poolKey: PoolKey): Hex =>
  encodeAbiParameters(parseAbiParameters("address currency0, address currency1"), [poolKey.currency0, poolKey.currency1]);

const sweepParams = (currency: Address, to: Address): Hex => encodeAbiParameters(parseAbiParameters("address currency, address to"), [currency, to]);

/** The pay steps after a liquidity action: settle both currencies, and sweep unused native ETH back to `owner`. */
function payActions(poolKey: PoolKey, owner: Address): { actions: number[]; params: Hex[] } {
  const actions: number[] = [ACTIONS.SETTLE_PAIR];
  const params: Hex[] = [settlePairParams(poolKey)];
  if (isNative(poolKey.currency0)) {
    actions.push(ACTIONS.SWEEP);
    params.push(sweepParams(poolKey.currency0, owner));
  }
  return { actions, params };
}

/** The ETH to send with a call that pays `amount0Max` of currency0: all of it when currency0 is native ETH. */
export const nativeValue = (poolKey: PoolKey, amount0Max: bigint): bigint => (isNative(poolKey.currency0) ? amount0Max : 0n);

export type MintParams = {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: Address;
  /** Unix seconds after which the PositionManager rejects the call. */
  deadline: bigint;
};

/** `modifyLiquidities` minting a position to `owner` and paying for it. */
export function encodeMint(params: MintParams): Hex {
  const mint = encodeAbiParameters(
    parseAbiParameters(
      `${POOL_KEY} poolKey, int24 tickLower, int24 tickUpper, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, address owner, bytes hookData`,
    ),
    [params.poolKey, params.tickLower, params.tickUpper, params.liquidity, params.amount0Max, params.amount1Max, params.owner, "0x"],
  );
  const pay = payActions(params.poolKey, params.owner);
  return encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "modifyLiquidities",
    args: [encodeUnlock([ACTIONS.MINT_POSITION, ...pay.actions], [mint, ...pay.params]), params.deadline],
  });
}

/**
 * One `multicall` that mints the position and subscribes it to `subscriber`. The new position's id is the
 * PositionManager's `nextTokenId` when the call runs, read just before sending as `tokenId`; if another mint lands
 * first, the subscribe names a position this wallet does not own and the whole call reverts, minting nothing.
 */
export function encodeMintAndSubscribe(params: MintParams & { tokenId: bigint; subscriber: Address }): Hex {
  return encodeFunctionData({ abi: positionManagerAbi, functionName: "multicall", args: [mintAndSubscribeCalls(params)] });
}

/** The two calls `encodeMintAndSubscribe` batches: the mint, then the subscribe. */
export function mintAndSubscribeCalls(params: MintParams & { tokenId: bigint; subscriber: Address }): [Hex, Hex] {
  const subscribe = encodeFunctionData({ abi: positionManagerAbi, functionName: "subscribe", args: [params.tokenId, params.subscriber, "0x"] });
  return [encodeMint(params), subscribe];
}

/** `modifyLiquidities` adding liquidity to an existing position. A subscribed position stays subscribed. */
export function encodeIncreaseLiquidity(params: {
  poolKey: PoolKey;
  tokenId: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: Address;
  deadline: bigint;
}): Hex {
  const increase = encodeAbiParameters(
    parseAbiParameters("uint256 tokenId, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, bytes hookData"),
    [params.tokenId, params.liquidity, params.amount0Max, params.amount1Max, "0x"],
  );
  const pay = payActions(params.poolKey, params.owner);
  return encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "modifyLiquidities",
    args: [encodeUnlock([ACTIONS.INCREASE_LIQUIDITY, ...pay.actions], [increase, ...pay.params]), params.deadline],
  });
}

/** Permit2 allowances expire; a new one lasts this long. */
export const PERMIT2_APPROVAL_SECONDS = 30 * 24 * 60 * 60;

export type TokenApproval = { erc20ToPermit2: bigint; permit2Amount: bigint; permit2Expiration: number };

/**
 * The approval steps a token still needs before the PositionManager can take `amount` of it through Permit2 at
 * `nowSeconds`: the token's approval of Permit2, then Permit2's approval of the PositionManager. Native ETH needs none.
 */
export function approvalSteps(currency: Address, amount: bigint, approval: TokenApproval, nowSeconds: number): ("erc20" | "permit2")[] {
  if (isNative(currency) || amount === 0n) return [];
  const steps: ("erc20" | "permit2")[] = [];
  if (approval.erc20ToPermit2 < amount) steps.push("erc20");
  if (approval.permit2Amount < amount || approval.permit2Expiration <= nowSeconds) steps.push("permit2");
  return steps;
}
