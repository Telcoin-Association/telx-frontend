import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";

/**
 * Calls to the Uniswap v4 PositionManager for adding liquidity and collecting fees, and the approvals they need. Liquidity changes go
 * through `modifyLiquidities(unlockData, deadline)`, where `unlockData` is `abi.encode(bytes actions, bytes[] params)`:
 * one action byte per step (v4-periphery `Actions`) and its parameters. Tokens are paid through Permit2, which the
 * PositionManager pulls from; native ETH (the zero address) is sent as the call's value, and any excess is swept
 * back to the owner.
 */

/** Permit2: one address on every chain. */
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** v4-periphery Actions used here. */
export const ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  SETTLE_PAIR: 0x0d,
  TAKE: 0x0e,
  SWEEP: 0x14,
} as const;

/** v4-periphery's ActionConstants.OPEN_DELTA: as a TAKE amount, it takes the whole credit owed for the currency. */
export const OPEN_DELTA = 0n;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export const positionManagerAbi = parseAbi([
  "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function subscribe(uint256 tokenId, address newSubscriber, bytes data) payable",
  "function nextTokenId() view returns (uint256)",
  "function permitBatch(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) _permitBatch, bytes signature) payable returns (bytes err)",
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

/**
 * `modifyLiquidities` collecting the trading fees of every position in `tokenIds` to `owner`, in one transaction.
 *
 * Each position gets a DECREASE_LIQUIDITY of zero: removing no liquidity still settles the position's fees, which the
 * PoolManager credits to the PositionManager. Then one TAKE per distinct currency with OPEN_DELTA pays out the whole
 * credit, so positions in several pools that share a currency (TEL) are paid once per currency rather than twice.
 * Native ETH (the zero address) is paid as ETH. Liquidity is unchanged, so a subscribed position stays subscribed;
 * its subscriber is told of a zero liquidity change with the fees collected.
 */
export function encodeCollectFees(params: CollectFeesParams): Hex {
  return encodeFunctionData({ abi: positionManagerAbi, functionName: "modifyLiquidities", args: collectFeesArgs(params) });
}

export type CollectFeesParams = { tokenIds: readonly bigint[]; currencies: readonly Address[]; owner: Address; deadline: bigint };

/** The `modifyLiquidities` arguments `encodeCollectFees` encodes: the unlock data and the deadline. */
export function collectFeesArgs(params: CollectFeesParams): [Hex, bigint] {
  if (params.tokenIds.length === 0) throw new Error("No positions to collect from.");
  const decrease = (tokenId: bigint) =>
    encodeAbiParameters(parseAbiParameters("uint256 tokenId, uint256 liquidity, uint128 amount0Min, uint128 amount1Min, bytes hookData"), [tokenId, 0n, 0n, 0n, "0x"]);
  // Lowercase encodes the same bytes and skips a checksum check on however the address was written.
  const recipient = params.owner.toLowerCase() as Address;
  const take = (currency: Address) =>
    encodeAbiParameters(parseAbiParameters("address currency, address recipient, uint256 amount"), [currency, recipient, OPEN_DELTA]);
  const currencies = [...new Map(params.currencies.map(currency => [currency.toLowerCase(), currency])).values()];
  const actions = [...params.tokenIds.map(() => ACTIONS.DECREASE_LIQUIDITY), ...currencies.map(() => ACTIONS.TAKE)];
  const actionParams = [...params.tokenIds.map(decrease), ...currencies.map(take)];
  return [encodeUnlock(actions, actionParams), params.deadline];
}

export type TokenApproval = { erc20ToPermit2: bigint; permit2Amount: bigint; permit2Expiration: number; permit2Nonce: number };


/** A signed Permit2 allowance lasts this long: long enough to confirm one add, short enough to leave nothing standing. */
export const PERMIT_SECONDS = 30 * 60;

/** A Permit2 allowance still counts only if it lasts at least this much longer, so it can't lapse mid-add. */
const PERMIT_MARGIN_SECONDS = 5 * 60;

export type PermitDetails = { token: Address; amount: bigint; expiration: number; nonce: number };

/** Whether the token already lets Permit2 move `amount` (an unlimited approval is made once per token). */
export const needsErc20Approval = (currency: Address, amount: bigint, approval: TokenApproval) =>
  !isNative(currency) && amount > 0n && approval.erc20ToPermit2 < amount;

/**
 * The Permit2 allowance to sign for one token, or null when its current allowance to the PositionManager already
 * covers `amount` for long enough. The signed allowance is exactly `amount` and lasts PERMIT_SECONDS.
 */
export function permitDetails(currency: Address, amount: bigint, approval: TokenApproval, nowSeconds: number): PermitDetails | null {
  if (isNative(currency) || amount === 0n) return null;
  if (approval.permit2Amount >= amount && approval.permit2Expiration > nowSeconds + PERMIT_MARGIN_SECONDS) return null;
  return { token: currency, amount, expiration: nowSeconds + PERMIT_SECONDS, nonce: approval.permit2Nonce };
}

/** The EIP-712 message Permit2 checks for a batch allowance to `spender` (Permit2's domain has no version). */
export function permitBatchTypedData(chainId: number, details: readonly PermitDetails[], spender: Address, sigDeadline: bigint) {
  return {
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2 },
    types: {
      PermitBatch: [
        { name: "details", type: "PermitDetails[]" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    primaryType: "PermitBatch",
    message: { details: details.map(d => ({ ...d })), spender, sigDeadline },
  } as const;
}

/**
 * The PositionManager call that applies a signed batch allowance, placed before the mint in the same multicall. The
 * PositionManager forwards it to Permit2 and doesn't revert if it fails; the mint then reverts for want of allowance.
 */
export function encodePermitBatch(owner: Address, details: readonly PermitDetails[], spender: Address, sigDeadline: bigint, signature: Hex): Hex {
  return encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "permitBatch",
    args: [owner, { details: details.map(d => ({ token: d.token, amount: d.amount, expiration: d.expiration, nonce: d.nonce })), spender, sigDeadline }, signature],
  });
}
