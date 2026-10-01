/**
 * @jest-environment node
 */
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import {
  encodeIncreaseLiquidity,
  encodePermitBatch,
  needsErc20Approval,
  PERMIT2,
  PERMIT_SECONDS,
  permitBatchTypedData,
  permitDetails,
  encodeMint,
  encodeMintAndSubscribe,
  nativeValue,
  poolKeyId,
  positionManagerAbi,
  type PoolKey,
} from "./positionManager";

const WETH: Address = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL: Address = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const OWNER: Address = getAddress("0x00000000000000000000000000000000000fe11a");
const SUBSCRIBER: Address = "0x19EDFa380ead0Bb26010Ca3d1C7AbC7213938c86";
const ERC20_POOL: PoolKey = { currency0: WETH, currency1: TEL, fee: 3000, tickSpacing: 60, hooks: zeroAddress };
const NATIVE_POOL: PoolKey = { currency0: zeroAddress, currency1: TEL, fee: 3000, tickSpacing: 60, hooks: zeroAddress };

const base = { tickLower: 137_460, tickUpper: 142_620, liquidity: 123_456n, amount0Max: 1_000n, amount1Max: 2_000n, owner: OWNER, deadline: 1_790_000_000n };

/** The action bytes and params of a modifyLiquidities call. */
function unlockOf(data: Hex): { actions: Hex; params: readonly Hex[]; deadline: bigint } {
  const call = decodeFunctionData({ abi: positionManagerAbi, data });
  expect(call.functionName).toBe("modifyLiquidities");
  const [unlockData, deadline] = call.args as [Hex, bigint];
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes actions, bytes[] params"), unlockData);
  return { actions, params, deadline };
}

describe("encodeMint", () => {
  it("mints then settles both tokens for an ERC-20 pair", () => {
    const { actions, params, deadline } = unlockOf(encodeMint({ poolKey: ERC20_POOL, ...base }));
    expect(actions).toBe("0x020d"); // MINT_POSITION, SETTLE_PAIR
    expect(deadline).toBe(base.deadline);
    const [poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData] = decodeAbiParameters(
      parseAbiParameters(
        "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, int24, int24, uint256, uint128, uint128, address, bytes",
      ),
      params[0],
    );
    expect(poolKey).toEqual(ERC20_POOL);
    expect([tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData]).toEqual([137_460, 142_620, 123_456n, 1_000n, 2_000n, OWNER, "0x"]);
    expect(decodeAbiParameters(parseAbiParameters("address, address"), params[1])).toEqual([WETH, TEL]);
  });

  it("sweeps unused native ETH back to the owner, and sends amount0Max as value", () => {
    const { actions, params } = unlockOf(encodeMint({ poolKey: NATIVE_POOL, ...base }));
    expect(actions).toBe("0x020d14"); // MINT_POSITION, SETTLE_PAIR, SWEEP
    expect(decodeAbiParameters(parseAbiParameters("address, address"), params[2])).toEqual([zeroAddress, OWNER]);
    expect(nativeValue(NATIVE_POOL, 1_000n)).toBe(1_000n);
    expect(nativeValue(ERC20_POOL, 1_000n)).toBe(0n);
  });
});

describe("encodeMintAndSubscribe", () => {
  it("is one multicall: the mint, then subscribe for the next token id", () => {
    const data = encodeMintAndSubscribe({ poolKey: ERC20_POOL, ...base, tokenId: 146_048n, subscriber: SUBSCRIBER });
    const call = decodeFunctionData({ abi: positionManagerAbi, data });
    expect(call.functionName).toBe("multicall");
    const [calls] = call.args as [readonly Hex[]];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(encodeMint({ poolKey: ERC20_POOL, ...base }));
    const subscribe = decodeFunctionData({ abi: positionManagerAbi, data: calls[1] });
    expect(subscribe.functionName).toBe("subscribe");
    expect(subscribe.args).toEqual([146_048n, SUBSCRIBER, "0x"]);
  });
});

describe("encodeIncreaseLiquidity", () => {
  it("increases an existing position and settles, sweeping native ETH", () => {
    const erc20 = unlockOf(encodeIncreaseLiquidity({ poolKey: ERC20_POOL, tokenId: 7n, liquidity: 5n, amount0Max: 1n, amount1Max: 2n, owner: OWNER, deadline: 9n }));
    expect(erc20.actions).toBe("0x000d"); // INCREASE_LIQUIDITY, SETTLE_PAIR
    expect(decodeAbiParameters(parseAbiParameters("uint256, uint256, uint128, uint128, bytes"), erc20.params[0])).toEqual([7n, 5n, 1n, 2n, "0x"]);
    expect(unlockOf(encodeIncreaseLiquidity({ poolKey: NATIVE_POOL, tokenId: 7n, liquidity: 5n, amount0Max: 1n, amount1Max: 2n, owner: OWNER, deadline: 9n })).actions).toBe(
      "0x000d14",
    );
  });
});

describe("approvals and the signed allowance", () => {
  const now = 1_790_000_000;
  const none = { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0, permit2Nonce: 3 };
  const approved = { erc20ToPermit2: 10n ** 30n, permit2Amount: 10n ** 30n, permit2Expiration: now + 3600, permit2Nonce: 3 };

  it("approves Permit2 once per token, never for native ETH or a zero amount", () => {
    expect(needsErc20Approval(TEL, 10n ** 18n, none)).toBe(true);
    expect(needsErc20Approval(TEL, 10n ** 18n, approved)).toBe(false);
    expect(needsErc20Approval(zeroAddress, 10n ** 18n, none)).toBe(false);
    expect(needsErc20Approval(TEL, 0n, none)).toBe(false);
  });

  it("signs exactly the amount, for PERMIT_SECONDS, at the current nonce, unless the allowance already covers it for long enough", () => {
    expect(permitDetails(TEL, 10n ** 18n, none, now)).toEqual({ token: TEL, amount: 10n ** 18n, expiration: now + PERMIT_SECONDS, nonce: 3 });
    expect(permitDetails(TEL, 10n ** 18n, approved, now)).toBeNull();
    expect(permitDetails(TEL, 10n ** 18n, { ...approved, permit2Amount: 1n }, now)).not.toBeNull();
    expect(permitDetails(TEL, 10n ** 18n, { ...approved, permit2Expiration: now + 60 }, now)).not.toBeNull();
    expect(permitDetails(zeroAddress, 10n ** 18n, none, now)).toBeNull();
  });

  it("builds Permit2's batch message and the PositionManager call that applies it", () => {
    const details = [permitDetails(WETH, 5n, none, now)!, permitDetails(TEL, 7n, none, now)!];
    const typed = permitBatchTypedData(137, details, SUBSCRIBER, 99n);
    expect(typed.domain).toEqual({ name: "Permit2", chainId: 137, verifyingContract: PERMIT2 });
    expect(typed.primaryType).toBe("PermitBatch");
    expect(typed.message).toEqual({ details, spender: SUBSCRIBER, sigDeadline: 99n });

    const signature: Hex = `0x${"ab".repeat(65)}`;
    const call = decodeFunctionData({ abi: positionManagerAbi, data: encodePermitBatch(OWNER, details, SUBSCRIBER, 99n, signature) });
    expect(call.functionName).toBe("permitBatch");
    expect(call.args).toEqual([OWNER, { details: details.map(d => ({ ...d, token: getAddress(d.token) })), spender: SUBSCRIBER, sigDeadline: 99n }, signature]);
  });
});

describe("poolKeyId", () => {
  it("is the first 25 bytes of the pool id", () => {
    expect(poolKeyId("0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d")).toBe("0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09a");
  });
});
