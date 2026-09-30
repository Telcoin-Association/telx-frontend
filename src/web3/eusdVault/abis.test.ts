/** @jest-environment node */
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  keccak256,
  multicall3Abi as viemMulticall3Abi,
  toBytes,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, multicall3Abi, vaultAbi } from "./abis";

const WALLET: Address = "0x1111111111111111111111111111111111111111";
const VAULT: Address = "0xc72178D412256a6Dc5f04D749859b4cd95076d61";
const EUSD: Address = "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949";
const USDC: Address = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const SWAP_TOPIC = "0xdba43ee9916cb156cc32a5d3406e87341e568126a46815294073ba25c9400246";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

/** First four bytes of keccak256 of the signature, without viem's ABI helpers. */
function selectorOf(signature: string): Hex {
  return keccak256(toBytes(signature)).slice(0, 10) as Hex;
}

function functionItem(abi: Abi, name: string): AbiFunction {
  const item = abi.find((entry) => entry.type === "function" && entry.name === name);
  if (!item || item.type !== "function") throw new Error(`missing function ${name}`);
  return item;
}

function namesOf(abi: Abi, type: "function" | "event" | "error"): string[] {
  return abi.flatMap((entry) => (entry.type === type ? [entry.name] : []));
}

describe("vaultAbi", () => {
  it("computes the Swap topic seen on chain", () => {
    expect(toEventSelector(getAbiItem({ abi: vaultAbi, name: "Swap" }))).toBe(SWAP_TOPIC);
    expect(toEventSelector("Swap(address,address,address,address,uint256,uint256,uint256)")).toBe(SWAP_TOPIC);
  });

  it("indexes only sender and recipient on Swap, in the source's field order", () => {
    const topics = encodeEventTopics({ abi: vaultAbi, eventName: "Swap", args: { sender: WALLET, recipient: WALLET } });
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [USDC, EUSD, 5_000_000n, 4_990_000n, 10_000n]
    );

    const log = decodeEventLog({ abi: vaultAbi, topics: topics as [Hex, ...Hex[]], data, strict: true });

    expect(topics).toHaveLength(3);
    expect(log).toEqual({
      eventName: "Swap",
      args: {
        sender: WALLET,
        recipient: WALLET,
        tokenIn: USDC,
        tokenOut: EUSD,
        amountIn: 5_000_000n,
        amountOut: 4_990_000n,
        fee: 10_000n,
      },
    });
  });

  it.each([
    ["sellGem", "sellGem(address,uint256)"],
    ["buyGem", "buyGem(address,uint256)"],
  ] as const)("encodes %s with the selector of %s, recipient first", (name, signature) => {
    const selector = selectorOf(signature);
    const calldata = encodeFunctionData({ abi: vaultAbi, functionName: name, args: [WALLET, 1_000_000n] });

    expect(toFunctionSelector(signature)).toBe(selector);
    expect(calldata.slice(0, 10)).toBe(selector);
    expect(calldata).toBe(
      `${selector}${encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [WALLET, 1_000_000n]).slice(2)}`
    );
  });

  it("matches every function signature in the Solidity source", () => {
    const signatures = {
      STABLE: "STABLE()",
      GEM: "GEM()",
      paused: "paused()",
      getReserves: "getReserves()",
      maxPerTransaction: "maxPerTransaction()",
      maxPerBlock: "maxPerBlock()",
      tin: "tin()",
      tout: "tout()",
      previewSellGem: "previewSellGem(uint256,address)",
      previewBuyGem: "previewBuyGem(uint256,address)",
      sellGem: "sellGem(address,uint256)",
      buyGem: "buyGem(address,uint256)",
    };

    expect(namesOf(vaultAbi, "function").sort()).toEqual(Object.keys(signatures).sort());
    for (const [name, signature] of Object.entries(signatures)) {
      expect(toFunctionSelector(functionItem(vaultAbi, name))).toBe(selectorOf(signature));
    }
  });

  it("returns the swap output amount from sellGem and buyGem", () => {
    for (const functionName of ["sellGem", "buyGem"] as const) {
      const data = encodeFunctionResult({ abi: vaultAbi, functionName, result: 4_990_000n });
      expect(decodeFunctionResult({ abi: vaultAbi, functionName, data })).toBe(4_990_000n);
      expect(functionItem(vaultAbi, functionName).stateMutability).toBe("nonpayable");
    }
  });

  it("returns reserves as (stable, gem)", () => {
    const data = encodeFunctionResult({ abi: vaultAbi, functionName: "getReserves", result: [500_000n, 150_000n] });

    expect(decodeFunctionResult({ abi: vaultAbi, functionName: "getReserves", data })).toEqual([500_000n, 150_000n]);
    expect(functionItem(vaultAbi, "getReserves").outputs.map((o) => o.name)).toEqual(["stableReserve", "gemReserve"]);
  });

  it("returns previews as (amountOut, fee) and takes (amount, recipient)", () => {
    for (const functionName of ["previewSellGem", "previewBuyGem"] as const) {
      const data = encodeFunctionResult({ abi: vaultAbi, functionName, result: [4_990_000n, 10_000n] });
      const item = functionItem(vaultAbi, functionName);

      expect(decodeFunctionResult({ abi: vaultAbi, functionName, data })).toEqual([4_990_000n, 10_000n]);
      expect(item.inputs.map((i) => i.type)).toEqual(["uint256", "address"]);
      expect(item.outputs.map((o) => o.name)).toEqual(
        functionName === "previewSellGem" ? ["amountOutStable", "feeStable"] : ["amountOutGem", "feeGem"]
      );
    }
  });

  it("declares each error name once", () => {
    const errors = namesOf(vaultAbi, "error");
    expect(new Set(errors).size).toBe(errors.length);
  });
});

// Signature, the selector where it is a well-known constant, and sample arguments.
const VAULT_ERRORS: ReadonlyArray<readonly [string, string, Hex | undefined, readonly unknown[]]> = [
  ["ZeroAmount", "ZeroAmount()", undefined, []],
  ["ZeroAddress", "ZeroAddress()", undefined, []],
  ["InsufficientReserves", "InsufficientReserves()", undefined, []],
  ["ExceedsTransactionLimit", "ExceedsTransactionLimit()", undefined, []],
  ["ExceedsBlockLimit", "ExceedsBlockLimit()", undefined, []],
  ["EnforcedPause", "EnforcedPause()", "0xd93c0665", []],
  ["SafeERC20FailedOperation", "SafeERC20FailedOperation(address)", "0x5274afe7", [EUSD]],
  ["ReentrancyGuardReentrantCall", "ReentrancyGuardReentrantCall()", "0x3ee5aeb5", []],
  ["Blacklisted", "Blacklisted(address)", undefined, [WALLET]],
  [
    "ERC20InsufficientAllowance",
    "ERC20InsufficientAllowance(address,uint256,uint256)",
    "0xfb8f41b2",
    [VAULT, 1n, 2n],
  ],
  ["ERC20InsufficientBalance", "ERC20InsufficientBalance(address,uint256,uint256)", "0xe450d38c", [WALLET, 1n, 2n]],
];

const TOKEN_ERRORS = new Set([
  "Blacklisted",
  "EnforcedPause",
  "ERC20InsufficientAllowance",
  "ERC20InsufficientBalance",
]);

describe.each([
  ["vaultAbi", vaultAbi as Abi, VAULT_ERRORS],
  ["erc20Abi", erc20Abi as Abi, VAULT_ERRORS.filter(([name]) => TOKEN_ERRORS.has(name))],
] as const)("%s custom errors", (_label, abi, errors) => {
  it("declares exactly the expected errors", () => {
    expect(namesOf(abi, "error").sort()).toEqual(errors.map(([name]) => name).sort());
  });

  it.each(errors)("round-trips %s", (errorName, signature, knownSelector, args) => {
    const data = encodeErrorResult({ abi, errorName, args });

    expect(data.slice(0, 10)).toBe(selectorOf(signature));
    if (knownSelector) expect(data.slice(0, 10)).toBe(knownSelector);
    expect(decodeErrorResult({ abi, data })).toMatchObject({ errorName, args: args.length ? args : undefined });
  });
});

describe("erc20Abi", () => {
  it("computes the standard Transfer and Approval topics", () => {
    expect(toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" }))).toBe(TRANSFER_TOPIC);
    expect(toEventSelector(getAbiItem({ abi: erc20Abi, name: "Approval" }))).toBe(APPROVAL_TOPIC);
  });

  it("matches the standard function selectors", () => {
    const selectors = {
      balanceOf: "0x70a08231",
      allowance: "0xdd62ed3e",
      approve: "0x095ea7b3",
      decimals: "0x313ce567",
      paused: "0x5c975abb",
    };

    expect(namesOf(erc20Abi, "function").sort()).toEqual(Object.keys(selectors).sort());
    for (const [name, selector] of Object.entries(selectors)) {
      expect(toFunctionSelector(functionItem(erc20Abi, name))).toBe(selector);
    }
  });

  it("decodes a Transfer log with from and to indexed", () => {
    const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: WALLET, to: VAULT } });
    const data = encodeAbiParameters([{ type: "uint256" }], [5_000_000n]);

    expect(decodeEventLog({ abi: erc20Abi, topics: topics as [Hex, ...Hex[]], data, strict: true })).toEqual({
      eventName: "Transfer",
      args: { from: WALLET, to: VAULT, value: 5_000_000n },
    });
  });
});

describe("multicall3Abi", () => {
  it("matches the canonical Multicall3 selectors", () => {
    expect(toFunctionSelector(functionItem(multicall3Abi, "aggregate3"))).toBe("0x82ad56cb");
    expect(toFunctionSelector(functionItem(multicall3Abi, "aggregate3"))).toBe(
      toFunctionSelector(functionItem(viemMulticall3Abi, "aggregate3"))
    );
    expect(toFunctionSelector(functionItem(multicall3Abi, "getChainId"))).toBe("0x3408e470");
    expect(toFunctionSelector(functionItem(multicall3Abi, "getBlockNumber"))).toBe("0x42cbb15c");
  });

  it("round-trips an aggregate3 result", () => {
    const result = [
      { success: true, returnData: "0x01" },
      { success: false, returnData: "0x" },
    ] as const;
    const data = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result });

    expect(decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data })).toEqual(result);
  });
});
