/** @jest-environment node */
import {
  BaseError,
  createClient,
  custom,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, multicall3Abi, vaultAbi } from "./abis";
import { VAULT_CHAIN_IDS, VAULT_DEPLOYMENTS, routeFor } from "./deployments";
import { AppError } from "./errors";
import {
  buildPageStateCalls,
  buildSnapshotCalls,
  createClientChainSource,
  decodePageState,
  decodeSnapshot,
} from "./reads";
import type { Multicall3Call, Multicall3Result, SwapDirection, VaultDeployment } from "./types";

const d = VAULT_DEPLOYMENTS[137];
const OWNER: Address = "0x1111111111111111111111111111111111111111";
const WAD = 10n ** 18n;
const DIRECTIONS: readonly SwapDirection[] = ["usdcToEusd", "eusdToUsdc"];

type ChainState = Readonly<{
  chainId: bigint;
  blockNumber: bigint;
  vaultPaused: boolean;
  stablePaused: boolean;
  reserves: readonly [bigint, bigint];
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  tin: bigint;
  tout: bigint;
  balances: Readonly<{ stable: bigint; gem: bigint }>;
  allowances: Readonly<{ stable: bigint; gem: bigint }>;
}>;

// Distinct values everywhere so a read from the wrong token or the wrong field shows up.
const STATE: ChainState = {
  chainId: 137n,
  blockNumber: 77_000_000n,
  vaultPaused: false,
  stablePaused: false,
  reserves: [298_000_000000n, 252_000_000000n],
  maxPerTransaction: 50_000n * WAD,
  maxPerBlock: 200_000n * WAD,
  tin: WAD / 1000n,
  tout: (2n * WAD) / 1000n,
  balances: { stable: 7_000000n, gem: 3_000000n },
  allowances: { stable: 5_000000n, gem: 2_000000n },
};

function tokenKey(target: Address, deployment: VaultDeployment = d): "stable" | "gem" {
  if (isAddressEqual(target, deployment.stable)) return "stable";
  if (isAddressEqual(target, deployment.gem)) return "gem";
  throw new Error(`unexpected token ${target}`);
}

/** Answers a call the way the deployed contracts would, from `STATE`. */
function answer(call: Multicall3Call, s: ChainState = STATE): Hex {
  if (isAddressEqual(call.target, d.multicall3)) {
    const { functionName } = decodeFunctionData({ abi: multicall3Abi, data: call.callData });
    if (functionName === "getChainId") {
      return encodeFunctionResult({ abi: multicall3Abi, functionName, result: s.chainId });
    }
    if (functionName === "getBlockNumber") {
      return encodeFunctionResult({ abi: multicall3Abi, functionName, result: s.blockNumber });
    }
    throw new Error(`unexpected Multicall3 call ${functionName}`);
  }
  if (isAddressEqual(call.target, d.vault)) {
    const decoded = decodeFunctionData({ abi: vaultAbi, data: call.callData });
    switch (decoded.functionName) {
      case "STABLE":
        return encodeFunctionResult({ abi: vaultAbi, functionName: "STABLE", result: d.stable });
      case "GEM":
        return encodeFunctionResult({ abi: vaultAbi, functionName: "GEM", result: d.gem });
      case "paused":
        return encodeFunctionResult({ abi: vaultAbi, functionName: "paused", result: s.vaultPaused });
      case "getReserves":
        return encodeFunctionResult({ abi: vaultAbi, functionName: "getReserves", result: s.reserves });
      case "maxPerTransaction":
      case "maxPerBlock": {
        const { functionName } = decoded;
        return encodeFunctionResult({ abi: vaultAbi, functionName, result: s[functionName] });
      }
      case "previewSellGem": {
        const [amount] = decoded.args;
        const fee = (amount * s.tout) / WAD;
        return encodeFunctionResult({ abi: vaultAbi, functionName: "previewSellGem", result: [amount - fee, fee] });
      }
      case "previewBuyGem": {
        const [amount] = decoded.args;
        const fee = (amount * s.tin) / WAD;
        return encodeFunctionResult({ abi: vaultAbi, functionName: "previewBuyGem", result: [amount - fee, fee] });
      }
      default:
        throw new Error(`unexpected vault call ${decoded.functionName}`);
    }
  }
  const token = tokenKey(call.target);
  const decoded = decodeFunctionData({ abi: erc20Abi, data: call.callData });
  switch (decoded.functionName) {
    case "balanceOf":
      return encodeFunctionResult({
        abi: erc20Abi,
        functionName: "balanceOf",
        result: isAddressEqual(decoded.args[0], OWNER) ? s.balances[token] : 0n,
      });
    case "allowance": {
      const [owner, spender] = decoded.args;
      const value = isAddressEqual(owner, OWNER) && isAddressEqual(spender, d.vault) ? s.allowances[token] : 0n;
      return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: value });
    }
    case "paused":
      if (token !== "stable") throw new Error("USDC has no paused() in this ABI");
      return encodeFunctionResult({ abi: erc20Abi, functionName: "paused", result: s.stablePaused });
    default:
      throw new Error(`unexpected token call ${decoded.functionName}`);
  }
}

function serve(calls: readonly Multicall3Call[], s: ChainState = STATE): Multicall3Result[] {
  return calls.map((call) => ({ success: true, returnData: answer(call, s) }));
}

function replaceAt(results: readonly Multicall3Result[], index: number, r: Multicall3Result): Multicall3Result[] {
  return results.map((existing, i) => (i === index ? r : existing));
}

const EMPTY: Multicall3Result = { success: true, returnData: "0x" };

const REVERTED: Multicall3Result = {
  success: false,
  returnData: encodeErrorResult({ abi: vaultAbi, errorName: "EnforcedPause" }),
};

/** A readable form of a call: which pinned contract, which function, which arguments. */
function describeCall(call: Multicall3Call): readonly unknown[] {
  if (isAddressEqual(call.target, d.multicall3)) {
    return ["Multicall3", decodeFunctionData({ abi: multicall3Abi, data: call.callData }).functionName];
  }
  if (isAddressEqual(call.target, d.vault)) {
    const { functionName, args } = decodeFunctionData({ abi: vaultAbi, data: call.callData });
    return args === undefined ? ["vault", functionName] : ["vault", functionName, ...args];
  }
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.callData });
  const name = tokenKey(call.target) === "stable" ? "eUSD" : "USDC";
  return args === undefined ? [name, functionName] : [name, functionName, ...args];
}

function quoteFor(direction: SwapDirection, amount: bigint) {
  const fee = (amount * (direction === "usdcToEusd" ? STATE.tout : STATE.tin)) / WAD;
  return { amountOut: amount - fee, fee };
}

const AMOUNT = 1_500000n;

describe("buildSnapshotCalls", () => {
  it.each(DIRECTIONS)("reads the preflight snapshot in order for %s", (direction) => {
    const route = routeFor(d, direction);
    const tokenIn = route.symbolIn;
    const calls = buildSnapshotCalls(d, route, OWNER, AMOUNT);

    expect(calls.map(describeCall)).toEqual([
      ["Multicall3", "getChainId"],
      ["Multicall3", "getBlockNumber"],
      ["vault", "STABLE"],
      ["vault", "GEM"],
      ["vault", "paused"],
      ["eUSD", "paused"],
      ["vault", "getReserves"],
      ["vault", "maxPerTransaction"],
      ["vault", "maxPerBlock"],
      ["vault", route.previewFunction, AMOUNT, OWNER],
      [tokenIn, "balanceOf", OWNER],
      [tokenIn, "allowance", OWNER, d.vault],
    ]);
    // Only the preview may fail.
    expect(calls.map((c) => c.allowFailure)).toEqual([...Array(9).fill(false), true, false, false]);
  });

  it("takes the input token from the deployment, not from the route's addresses", () => {
    const foreignRoute = routeFor(VAULT_DEPLOYMENTS[1], "usdcToEusd");
    const calls = buildSnapshotCalls(d, foreignRoute, OWNER, AMOUNT);
    expect(isAddressEqual(calls[10].target, d.gem)).toBe(true);
    expect(isAddressEqual(calls[11].target, d.gem)).toBe(true);
  });
});

describe("decodeSnapshot", () => {
  it.each(DIRECTIONS)("decodes the chain's answers for %s", (direction) => {
    const route = routeFor(d, direction);
    const results = serve(buildSnapshotCalls(d, route, OWNER, AMOUNT));
    const inKey = direction === "usdcToEusd" ? "gem" : "stable";

    expect(decodeSnapshot(route, results)).toEqual({
      chainId: 137,
      blockNumber: STATE.blockNumber,
      stable: d.stable,
      gem: d.gem,
      vaultPaused: false,
      stablePaused: false,
      stableReserve: STATE.reserves[0],
      gemReserve: STATE.reserves[1],
      maxPerTransaction: STATE.maxPerTransaction,
      maxPerBlock: STATE.maxPerBlock,
      quote: quoteFor(direction, AMOUNT),
      balanceIn: STATE.balances[inKey],
      allowanceIn: STATE.allowances[inKey],
    });
  });

  it("decodes a paused vault and a paused eUSD", () => {
    const route = routeFor(d, "usdcToEusd");
    const paused = { ...STATE, vaultPaused: true, stablePaused: true };
    const results = serve(buildSnapshotCalls(d, route, OWNER, AMOUNT), paused);
    const snapshot = decodeSnapshot(route, results);
    expect(snapshot.vaultPaused).toBe(true);
    expect(snapshot.stablePaused).toBe(true);
  });

  it("leaves the quote undefined when the preview failed", () => {
    const route = routeFor(d, "eusdToUsdc");
    const results = serve(buildSnapshotCalls(d, route, OWNER, AMOUNT));
    const snapshot = decodeSnapshot(route, replaceAt(results, 9, REVERTED));
    expect(snapshot.quote).toBeUndefined();
    expect(snapshot.balanceIn).toBe(STATE.balances.stable);
  });

  it("leaves the quote undefined when the preview returned no data", () => {
    const route = routeFor(d, "usdcToEusd");
    const results = serve(buildSnapshotCalls(d, route, OWNER, AMOUNT));
    expect(decodeSnapshot(route, replaceAt(results, 9, EMPTY)).quote).toBeUndefined();
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11])("throws when required sub-call %i failed", (index) => {
    const route = routeFor(d, "usdcToEusd");
    const results = replaceAt(serve(buildSnapshotCalls(d, route, OWNER, AMOUNT)), index, REVERTED);
    expect(() => decodeSnapshot(route, results)).toThrow(AppError);
  });

  it.each([
    ["no data", "0x" as Hex],
    ["a bool that is neither 0 nor 1", encodeFunctionResult({ abi: vaultAbi, functionName: "tin", result: 2n })],
  ])("throws when a required sub-call returned %s", (_, returnData) => {
    const route = routeFor(d, "usdcToEusd");
    const results = replaceAt(serve(buildSnapshotCalls(d, route, OWNER, AMOUNT)), 4, { success: true, returnData });
    expect(() => decodeSnapshot(route, results)).toThrow(AppError);
  });

  it("throws on a wrong result count", () => {
    const route = routeFor(d, "usdcToEusd");
    const results = serve(buildSnapshotCalls(d, route, OWNER, AMOUNT));
    expect(() => decodeSnapshot(route, results.slice(0, -1))).toThrow(AppError);
    expect(() => decodeSnapshot(route, [...results, results[0]])).toThrow(AppError);
    expect(() => decodeSnapshot(route, [])).toThrow(AppError);
  });

  it("never puts decoder text in the message", () => {
    const route = routeFor(d, "usdcToEusd");
    const results = replaceAt(serve(buildSnapshotCalls(d, route, OWNER, AMOUNT)), 6, EMPTY);
    expect(() => decodeSnapshot(route, results)).toThrow("The vault's state could not be read. Try again shortly.");
  });
});

const PAGE_FIXED = [
  ["Multicall3", "getChainId"],
  ["Multicall3", "getBlockNumber"],
  ["vault", "STABLE"],
  ["vault", "GEM"],
  ["vault", "paused"],
  ["eUSD", "paused"],
  ["vault", "getReserves"],
  ["vault", "maxPerTransaction"],
  ["vault", "maxPerBlock"],
];

const OWNER_READS = [
  ["eUSD", "balanceOf", OWNER],
  ["USDC", "balanceOf", OWNER],
  ["eUSD", "allowance", OWNER, d.vault],
  ["USDC", "allowance", OWNER, d.vault],
];

describe("buildPageStateCalls", () => {
  it("reads only the vault state when disconnected with no amount", () => {
    const calls = buildPageStateCalls(d, "usdcToEusd", undefined, undefined);
    expect(calls.map(describeCall)).toEqual(PAGE_FIXED);
    expect(calls.every((c) => c.allowFailure)).toBe(true);
  });

  it("builds no preview for a zero amount", () => {
    expect(buildPageStateCalls(d, "usdcToEusd", undefined, 0n).map(describeCall)).toEqual(PAGE_FIXED);
    expect(buildPageStateCalls(d, "eusdToUsdc", OWNER, 0n).map(describeCall)).toEqual([...PAGE_FIXED, ...OWNER_READS]);
  });

  it.each(DIRECTIONS)("quotes a disconnected visitor with the zero address as recipient for %s", (direction) => {
    const calls = buildPageStateCalls(d, direction, undefined, AMOUNT);
    expect(calls.map(describeCall)).toEqual([
      ...PAGE_FIXED,
      ["vault", routeFor(d, direction).previewFunction, AMOUNT, zeroAddress],
    ]);
  });

  it.each(DIRECTIONS)("adds the preview for the owner and both tokens' reads when connected for %s", (direction) => {
    const calls = buildPageStateCalls(d, direction, OWNER, AMOUNT);
    expect(calls.map(describeCall)).toEqual([
      ...PAGE_FIXED,
      ["vault", routeFor(d, direction).previewFunction, AMOUNT, OWNER],
      ...OWNER_READS,
    ]);
    expect(calls.every((c) => c.allowFailure)).toBe(true);
  });

  it("reads the wallet without a preview when connected with no amount", () => {
    expect(buildPageStateCalls(d, "usdcToEusd", OWNER, undefined).map(describeCall)).toEqual([
      ...PAGE_FIXED,
      ...OWNER_READS,
    ]);
  });
});

describe("decodePageState", () => {
  it.each(DIRECTIONS)("decodes the chain's answers for a connected wallet for %s", (direction) => {
    const results = serve(buildPageStateCalls(d, direction, OWNER, AMOUNT));
    expect(decodePageState(direction, OWNER, AMOUNT, results)).toEqual({
      chainId: 137,
      blockNumber: STATE.blockNumber,
      stable: d.stable,
      gem: d.gem,
      vaultPaused: false,
      stablePaused: false,
      stableReserve: STATE.reserves[0],
      gemReserve: STATE.reserves[1],
      maxPerTransaction: STATE.maxPerTransaction,
      maxPerBlock: STATE.maxPerBlock,
      quote: quoteFor(direction, AMOUNT),
      balances: STATE.balances,
      allowances: STATE.allowances,
    });
  });

  it("leaves the wallet's reads and the quote undefined when disconnected with no amount", () => {
    const results = serve(buildPageStateCalls(d, "usdcToEusd", undefined, undefined));
    const state = decodePageState("usdcToEusd", undefined, undefined, results);
    expect(state.quote).toBeUndefined();
    expect(state.balances).toBeUndefined();
    expect(state.allowances).toBeUndefined();
    expect(state.maxPerBlock).toBe(STATE.maxPerBlock);
  });

  it("decodes the quote for a disconnected visitor", () => {
    const results = serve(buildPageStateCalls(d, "eusdToUsdc", undefined, AMOUNT));
    const state = decodePageState("eusdToUsdc", undefined, AMOUNT, results);
    expect(state.quote).toEqual(quoteFor("eusdToUsdc", AMOUNT));
    expect(state.balances).toBeUndefined();
  });

  it("decodes a connected wallet with no amount", () => {
    const results = serve(buildPageStateCalls(d, "usdcToEusd", OWNER, undefined));
    const state = decodePageState("usdcToEusd", OWNER, undefined, results);
    expect(state.quote).toBeUndefined();
    expect(state.balances).toEqual(STATE.balances);
    expect(state.allowances).toEqual(STATE.allowances);
  });

  it.each([
    ["vault", 4, "vaultPaused", "stablePaused"],
    ["eUSD", 5, "stablePaused", "vaultPaused"],
  ] as const)("counts a failed %s paused read as paused", (_, index, failed, other) => {
    const results = serve(buildPageStateCalls(d, "usdcToEusd", OWNER, AMOUNT));
    const reverted = decodePageState("usdcToEusd", OWNER, AMOUNT, replaceAt(results, index, REVERTED));
    expect(reverted[failed]).toBe(true);
    expect(reverted[other]).toBe(false);
    const empty = decodePageState("usdcToEusd", OWNER, AMOUNT, replaceAt(results, index, EMPTY));
    expect(empty[failed]).toBe(true);
    const notABool = encodeFunctionResult({ abi: vaultAbi, functionName: "tin", result: 7n });
    const garbled = decodePageState(
      "usdcToEusd",
      OWNER,
      AMOUNT,
      replaceAt(results, index, { success: true, returnData: notABool })
    );
    expect(garbled[failed]).toBe(true);
  });

  it("leaves the quote undefined when the preview failed", () => {
    const results = serve(buildPageStateCalls(d, "usdcToEusd", OWNER, AMOUNT));
    const state = decodePageState("usdcToEusd", OWNER, AMOUNT, replaceAt(results, 9, REVERTED));
    expect(state.quote).toBeUndefined();
    expect(state.balances).toEqual(STATE.balances);
  });

  it.each([0, 1, 2, 3, 6, 7, 8, 10, 11, 12, 13])("throws when sub-call %i failed", (index) => {
    const results = replaceAt(serve(buildPageStateCalls(d, "eusdToUsdc", OWNER, AMOUNT)), index, REVERTED);
    expect(() => decodePageState("eusdToUsdc", OWNER, AMOUNT, results)).toThrow(AppError);
  });

  it("throws when a result is missing or extra", () => {
    const results = serve(buildPageStateCalls(d, "usdcToEusd", OWNER, AMOUNT));
    expect(() => decodePageState("usdcToEusd", OWNER, AMOUNT, results.slice(0, -1))).toThrow(AppError);
    // Decoding with a different layout than the one built is a count mismatch, not a misread.
    expect(() => decodePageState("usdcToEusd", undefined, AMOUNT, results)).toThrow(AppError);
    expect(() => decodePageState("usdcToEusd", OWNER, undefined, results)).toThrow(AppError);
  });
});

describe("call targets", () => {
  it("are only the deployment's pinned addresses", () => {
    for (const chainId of VAULT_CHAIN_IDS) {
      const deployment = VAULT_DEPLOYMENTS[chainId];
      const pinned = [deployment.vault, deployment.stable, deployment.gem, deployment.multicall3];
      const targets: Address[] = [];
      for (const direction of DIRECTIONS) {
        const route = routeFor(deployment, direction);
        targets.push(...buildSnapshotCalls(deployment, route, OWNER, AMOUNT).map((c) => c.target));
        for (const owner of [undefined, OWNER]) {
          for (const amount of [undefined, 0n, AMOUNT]) {
            targets.push(...buildPageStateCalls(deployment, direction, owner, amount).map((c) => c.target));
          }
        }
      }
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(pinned.some((p) => isAddressEqual(p, target))).toBe(true);
      }
      // Every pinned contract is read.
      for (const p of pinned) expect(targets.some((t) => isAddressEqual(p, t))).toBe(true);
    }
  });
});

type RpcRequest = Readonly<{ method: string; params?: unknown }>;

function fakeClient(handler: (request: RpcRequest) => unknown) {
  const requests: RpcRequest[] = [];
  const client = createClient({
    transport: custom(
      {
        async request(request: RpcRequest) {
          requests.push(request);
          return handler(request);
        },
      },
      { retryCount: 0 }
    ),
  });
  return { client, requests };
}

function callParams(request: RpcRequest): readonly [Readonly<{ from?: Address; to: Address; data: Hex }>, string] {
  return request.params as readonly [Readonly<{ from?: Address; to: Address; data: Hex }>, string];
}

describe("createClientChainSource", () => {
  const calls = buildSnapshotCalls(d, routeFor(d, "usdcToEusd"), OWNER, AMOUNT);
  const results = serve(calls);
  const encoded = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });

  it.each([
    ["at the given block as hex", 123_456n, "0x1e240"],
    ["at latest without a block", undefined, "latest"],
  ])("sends one eth_call to Multicall3 %s", async (_, blockNumber, tag) => {
    const { client, requests } = fakeClient(() => encoded);
    const answered = await createClientChainSource(client).aggregate3(d.multicall3, calls, blockNumber);

    expect(answered).toEqual(results);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("eth_call");
    const [tx, block] = callParams(requests[0]);
    expect(isAddressEqual(tx.to, d.multicall3)).toBe(true);
    expect(block).toBe(tag);
    const sent = decodeFunctionData({ abi: multicall3Abi, data: tx.data });
    expect(sent.functionName).toBe("aggregate3");
    expect(sent.args?.[0]).toEqual(calls);
  });

  it("does not split a large aggregate3", async () => {
    const many = Array.from({ length: 40 }, () => calls).flat();
    const manyResults = serve(many);
    const { client, requests } = fakeClient(() =>
      encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: manyResults })
    );
    await expect(createClientChainSource(client).aggregate3(d.multicall3, many)).resolves.toHaveLength(many.length);
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["sellGem", 1_234_000n],
    ["buyGem", 987_000n],
  ] as const)("simulates %s from the account at latest and returns the output amount", async (functionName, out) => {
    const account: Address = "0x2222222222222222222222222222222222222222";
    const recipient: Address = "0x3333333333333333333333333333333333333333";
    const { client, requests } = fakeClient(() => encodeFunctionResult({ abi: vaultAbi, functionName, result: out }));

    const amountOut = await createClientChainSource(client).simulateSwap({
      vault: d.vault,
      functionName,
      account,
      recipient,
      amountIn: AMOUNT,
    });

    expect(amountOut).toBe(out);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("eth_call");
    const [tx, block] = callParams(requests[0]);
    expect(tx.from && isAddressEqual(tx.from, account)).toBe(true);
    expect(isAddressEqual(tx.to, d.vault)).toBe(true);
    expect(block).toBe("latest");
    const sent = decodeFunctionData({ abi: vaultAbi, data: tx.data });
    expect(sent.functionName).toBe(functionName);
    expect(sent.args).toEqual([recipient, AMOUNT]);
  });

  it("asks for the block number every time", async () => {
    let head = 0x10;
    const { client, requests } = fakeClient(() => `0x${(head++).toString(16)}`);
    const source = createClientChainSource(client);

    await expect(source.getBlockNumber()).resolves.toBe(16n);
    await expect(source.getBlockNumber()).resolves.toBe(17n);
    expect(requests.map((r) => r.method)).toEqual(["eth_blockNumber", "eth_blockNumber"]);
  });

  it.each([
    ["an account with code", "0x6080604052", "0x6080604052"],
    ["an EOA's empty code", "0x", undefined],
    ["a null answer", null, undefined],
  ])("maps %s", async (_, rpcAnswer, expected) => {
    const { client, requests } = fakeClient(() => rpcAnswer);
    await expect(createClientChainSource(client).getCode(OWNER)).resolves.toBe(expected);
    expect(requests[0].method).toBe("eth_getCode");
  });

  it("lets viem's error through with the provider's error as its cause", async () => {
    const failure = Object.assign(new Error("header not found"), { code: -32000 });
    const { client } = fakeClient(() => {
      throw failure;
    });
    const error: unknown = await createClientChainSource(client)
      .aggregate3(d.multicall3, calls, 1n)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BaseError);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as BaseError).walk((e) => e === failure)).toBe(failure);
  });
});
