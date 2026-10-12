/**
 * @jest-environment node
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  closePositionArgs,
  closePositionCall,
  decreaseLiquidityArgs,
  encodeCollectFees,
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
  const increase = { tokenId: 7n, liquidity: 5n, amount0Max: 1n, amount1Max: 2n, owner: OWNER, deadline: 9n };

  it("increases an existing position, then closes each currency so fees larger than the deposit are paid out", () => {
    const erc20 = unlockOf(encodeIncreaseLiquidity({ poolKey: ERC20_POOL, ...increase }));
    expect(erc20.actions).toBe("0x001212"); // INCREASE_LIQUIDITY, CLOSE_CURRENCY, CLOSE_CURRENCY
    expect(erc20.deadline).toBe(9n);
    // IncreaseLiquidity: (uint256 tokenId, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, bytes hookData)
    expect(decodeAbiParameters(parseAbiParameters("uint256, uint256, uint128, uint128, bytes"), erc20.params[0])).toEqual([7n, 5n, 1n, 2n, "0x"]);
    // CloseCurrency: (Currency currency), currency0 then currency1
    expect(decodeAbiParameters(parseAbiParameters("address"), erc20.params[1])).toEqual([WETH]);
    expect(decodeAbiParameters(parseAbiParameters("address"), erc20.params[2])).toEqual([TEL]);
  });

  it("sweeps unused native ETH back to the owner", () => {
    const native = unlockOf(encodeIncreaseLiquidity({ poolKey: NATIVE_POOL, ...increase }));
    expect(native.actions).toBe("0x00121214"); // ..., SWEEP
    expect(decodeAbiParameters(parseAbiParameters("address, address"), native.params[3])).toEqual([zeroAddress, OWNER]);
  });
});

const modify = (args: readonly [Hex, bigint]) => encodeFunctionData({ abi: positionManagerAbi, functionName: "modifyLiquidities", args });

describe("decreaseLiquidityArgs", () => {
  it("decreases with minimum amounts, then takes both currencies to the owner", () => {
    const { actions, params, deadline } = unlockOf(
      modify(
        decreaseLiquidityArgs({ poolKey: NATIVE_POOL, tokenId: 7n, liquidity: 500n, amount0Min: 3n, amount1Min: 4n, owner: OWNER, deadline: 9n }),
      ),
    );
    expect(actions).toBe("0x0111"); // DECREASE_LIQUIDITY, TAKE_PAIR
    expect(deadline).toBe(9n);
    // DecreaseLiquidity: (uint256 tokenId, uint256 liquidity, uint128 amount0Min, uint128 amount1Min, bytes hookData)
    expect(decodeAbiParameters(parseAbiParameters("uint256, uint256, uint128, uint128, bytes"), params[0])).toEqual([7n, 500n, 3n, 4n, "0x"]);
    // TakePair: (Currency currency0, Currency currency1, address recipient); native ETH is taken as ETH, so no sweep
    expect(decodeAbiParameters(parseAbiParameters("address, address, address"), params[1])).toEqual([zeroAddress, TEL, OWNER]);
    expect(params).toHaveLength(2);
  });
});

describe("closePositionArgs and closePositionCall", () => {
  const close = { tokenId: 7n, amount0Min: 3n, amount1Min: 4n, owner: OWNER, deadline: 9n };

  it("burns with minimum amounts, then takes both currencies", () => {
    const { actions, params } = unlockOf(modify(closePositionArgs({ poolKey: ERC20_POOL, ...close })));
    expect(actions).toBe("0x0311"); // BURN_POSITION, TAKE_PAIR
    // BurnPosition: (uint256 tokenId, uint128 amount0Min, uint128 amount1Min, bytes hookData)
    expect(decodeAbiParameters(parseAbiParameters("uint256, uint128, uint128, bytes"), params[0])).toEqual([7n, 3n, 4n, "0x"]);
    expect(decodeAbiParameters(parseAbiParameters("address, address, address"), params[1])).toEqual([WETH, TEL, OWNER]);
  });

  it("sweeps native ETH to the owner in a native pool", () => {
    const { actions, params } = unlockOf(modify(closePositionArgs({ poolKey: NATIVE_POOL, ...close })));
    expect(actions).toBe("0x031114"); // BURN_POSITION, TAKE_PAIR, SWEEP
    expect(decodeAbiParameters(parseAbiParameters("address, address"), params[2])).toEqual([zeroAddress, OWNER]);
  });

  it("keeps the calldata layout byte for byte", () => {
    expect(closePositionArgs({ poolKey: ERC20_POOL, ...close })[0]).toBe(
      "0x" +
        "0000000000000000000000000000000000000000000000000000000000000040" + // offset of actions
        "0000000000000000000000000000000000000000000000000000000000000080" + // offset of params
        "0000000000000000000000000000000000000000000000000000000000000002" + // two action bytes
        "0311000000000000000000000000000000000000000000000000000000000000" + // BURN_POSITION, TAKE_PAIR
        "0000000000000000000000000000000000000000000000000000000000000002" + // two params
        "0000000000000000000000000000000000000000000000000000000000000040" +
        "0000000000000000000000000000000000000000000000000000000000000100" + // offsets of the two params
        "00000000000000000000000000000000000000000000000000000000000000a0" + // burn params: 160 bytes
        "0000000000000000000000000000000000000000000000000000000000000007" + // tokenId
        "0000000000000000000000000000000000000000000000000000000000000003" + // amount0Min
        "0000000000000000000000000000000000000000000000000000000000000004" + // amount1Min
        "0000000000000000000000000000000000000000000000000000000000000080" + // offset of hookData
        "0000000000000000000000000000000000000000000000000000000000000000" + // empty hookData
        "0000000000000000000000000000000000000000000000000000000000000060" + // take pair params: 96 bytes
        "0000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619" +
        "0000000000000000000000007e13b43065380acdec1c2d138c579cbbbafa0731" +
        "00000000000000000000000000000000000000000000000000000000000fe11a",
    );
  });

  it("burns an unsubscribed position directly", () => {
    const call = closePositionCall({ poolKey: ERC20_POOL, ...close, subscribed: false });
    expect(call).toEqual({ functionName: "modifyLiquidities", args: closePositionArgs({ poolKey: ERC20_POOL, ...close }) });
  });

  it("unsubscribes a subscribed position first, in the same multicall as the burn", () => {
    const call = closePositionCall({ poolKey: NATIVE_POOL, ...close, subscribed: true });
    expect(call.functionName).toBe("multicall");
    const [calls] = call.args as [Hex[]];
    expect(calls).toHaveLength(2);
    const first = decodeFunctionData({ abi: positionManagerAbi, data: calls[0] });
    expect(first.functionName).toBe("unsubscribe");
    expect(first.args).toEqual([7n]);
    expect(calls[1]).toBe(modify(closePositionArgs({ poolKey: NATIVE_POOL, ...close })));
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

describe("encodeCollectFees", () => {
  const EUSD: Address = "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949";
  const decrease = (params: Hex) => decodeAbiParameters(parseAbiParameters("uint256, uint256, uint128, uint128, bytes"), params);
  const take = (params: Hex) => decodeAbiParameters(parseAbiParameters("address, address, uint256"), params);

  it("decreases one position by zero and takes both currencies to the owner", () => {
    const { actions, params, deadline } = unlockOf(encodeCollectFees({ tokenIds: [144097n], currencies: [WETH, TEL], owner: OWNER, deadline: 1_790_000_000n }));
    expect(actions).toBe("0x010e0e");
    expect(decrease(params[0])).toEqual([144097n, 0n, 0n, 0n, "0x"]);
    expect(take(params[1])).toEqual([WETH, OWNER, 0n]);
    expect(take(params[2])).toEqual([TEL, OWNER, 0n]);
    expect(deadline).toBe(1_790_000_000n);
  });

  it("batches several positions and takes a currency they share once, in any letter case", () => {
    const { actions, params } = unlockOf(
      encodeCollectFees({ tokenIds: [144097n, 144103n], currencies: [WETH, TEL, EUSD, TEL.toLowerCase() as Address], owner: OWNER, deadline: 1n }),
    );
    expect(actions).toBe("0x01010e0e0e");
    expect([decrease(params[0])[0], decrease(params[1])[0]]).toEqual([144097n, 144103n]);
    expect(params.slice(2).map(p => take(p)[0])).toEqual([WETH, TEL, EUSD]);
  });

  it("takes native ETH as the zero-address currency, so it is paid as ETH", () => {
    const { actions, params } = unlockOf(encodeCollectFees({ tokenIds: [3104904n], currencies: [zeroAddress, TEL], owner: OWNER, deadline: 1n }));
    expect(actions).toBe("0x010e0e");
    expect(take(params[1])).toEqual([zeroAddress, OWNER, 0n]);
  });

  it("refuses an empty list rather than encode a call that collects nothing", () => {
    expect(() => encodeCollectFees({ tokenIds: [], currencies: [WETH], owner: OWNER, deadline: 1n })).toThrow("No positions to collect from.");
  });
});
