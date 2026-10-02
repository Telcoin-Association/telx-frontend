/**
 * @jest-environment node
 */
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { describeCollect, readCollect, type CollectTarget } from "./collect";
import { positionManagerAbi } from "./positionManager";

const PM: Address = "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9";
const OWNER: Address = "0x00000000000000000000000000000000000000Aa";
const OWNER_DECODED: Address = getAddress(OWNER.toLowerCase());
const WETH: Address = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL: Address = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const EUSD: Address = "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949";
const Q128 = 2n ** 128n;
const WETH_TEL = `0xa2${"0".repeat(62)}` as Hex;
const EUSD_TEL = `0x12${"0".repeat(62)}` as Hex;
const ETH_TEL = `0x27${"0".repeat(62)}` as Hex;

type Call = { functionName: string; args?: readonly unknown[]; address: Address };

/**
 * A fake chain: pools by their 25-byte key, positions by token id as (liquidity, fees in base units), and token
 * metadata. Fee growth is reported as fee × 2^128 with liquidity 1 per unit, so owed fees come back exactly.
 */
function fakeClient(positions: Record<string, { liquidity: bigint; fee0: bigint; fee1: bigint }>, failing: string[] = []) {
  const keys: Record<string, [Address, Address]> = {
    [WETH_TEL.slice(0, 52)]: [WETH, TEL],
    [EUSD_TEL.slice(0, 52)]: [EUSD, TEL],
    [ETH_TEL.slice(0, 52)]: [zeroAddress, TEL],
  };
  const meta: Record<string, [number, string]> = { [WETH.toLowerCase()]: [18, "WETH"], [TEL.toLowerCase()]: [18, "TEL"], [EUSD.toLowerCase()]: [6, "eUSD"] };
  const answer = ({ functionName, args, address }: Call): unknown => {
    switch (functionName) {
      case "poolKeys":
        return [...keys[String(args![0])], 3000, 60, zeroAddress];
      case "getPositionInfo": {
        const id = BigInt(args![4] as string).toString();
        if (failing.includes(id)) throw new Error("reverted");
        const p = positions[id];
        // Liquidity 1 when the position has any, so growth × liquidity / 2^128 is the fee itself.
        return [p.liquidity > 0n ? 1n : 0n, 0n, 0n];
      }
      case "getFeeGrowthInside": {
        const p = Object.values(positions)[0];
        return [p.fee0 * Q128, p.fee1 * Q128];
      }
      case "decimals":
        return meta[address.toLowerCase()][0];
      case "symbol":
        return meta[address.toLowerCase()][1];
      default:
        throw new Error(`unexpected ${functionName}`);
    }
  };
  const multicall = jest.fn(async ({ contracts }: { contracts: Call[] }) =>
    contracts.map(call => {
      try {
        return { status: "success", result: answer(call) };
      } catch (error) {
        return { status: "failure", error };
      }
    }),
  );
  return { multicall } as unknown as Parameters<typeof readCollect>[0] & { multicall: jest.Mock };
}

const target = (tokenId: string, poolId: Hex): CollectTarget => ({ tokenId, poolId, tickLower: -60, tickUpper: 60 });

/** The token ids and taken currencies of a collect's unlock data. */
function decodeCollect(args: [Hex, bigint]) {
  const data = encodeFunctionData({ abi: positionManagerAbi, functionName: "modifyLiquidities", args });
  const [unlock] = decodeFunctionData({ abi: positionManagerAbi, data }).args as [Hex, bigint];
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes, bytes[]"), unlock);
  const count = (actions.length - 2) / 2;
  const ops = Array.from({ length: count }, (_, i) => actions.slice(2 + i * 2, 4 + i * 2));
  return {
    tokenIds: params.filter((_, i) => ops[i] === "01").map(p => decodeAbiParameters(parseAbiParameters("uint256"), p)[0]),
    taken: params.filter((_, i) => ops[i] === "0e").map(p => decodeAbiParameters(parseAbiParameters("address, address, uint256"), p)),
  };
}

describe("readCollect", () => {
  it("collects one position's fees, with each token's symbol and decimals, and a deadline 20 minutes out", async () => {
    const client = fakeClient({ "144097": { liquidity: 5n, fee0: 7n, fee1: 12n } });
    const plan = await readCollect(client, { chainId: 137, positionManager: PM, owner: OWNER, targets: [target("144097", WETH_TEL)], nowSeconds: 1_000 });

    expect(plan!.tokenIds).toEqual([144097n]);
    expect(plan!.amounts).toEqual([
      { currency: WETH.toLowerCase(), symbol: "WETH", decimals: 18, amount: 7n },
      { currency: TEL.toLowerCase(), symbol: "TEL", decimals: 18, amount: 12n },
    ]);
    expect(plan!.request.args[1]).toBe(2_200n);
    expect(decodeCollect(plan!.request.args)).toEqual({ tokenIds: [144097n], taken: [[WETH, OWNER_DECODED, 0n], [TEL, OWNER_DECODED, 0n]] });
  });

  it("sums a currency shared by several pools and takes it once", async () => {
    const client = fakeClient({ "1": { liquidity: 1n, fee0: 3n, fee1: 4n }, "2": { liquidity: 1n, fee0: 3n, fee1: 4n } });
    const plan = await readCollect(client, { chainId: 137, positionManager: PM, owner: OWNER, targets: [target("1", WETH_TEL), target("2", EUSD_TEL)] });
    expect(plan!.amounts.map(a => [a.symbol, a.amount])).toEqual([
      ["WETH", 3n],
      ["TEL", 8n],
      ["eUSD", 3n],
    ]);
    expect(decodeCollect(plan!.request.args).taken.map(([currency]) => currency.toLowerCase())).toEqual([WETH.toLowerCase(), TEL.toLowerCase(), EUSD.toLowerCase()]);
  });

  it("leaves out a position without liquidity, which the PoolManager would refuse, and is null when nothing is left", async () => {
    const client = fakeClient({ "3103375": { liquidity: 0n, fee0: 9n, fee1: 9n }, "3104904": { liquidity: 2n, fee0: 9n, fee1: 9n } });
    const plan = await readCollect(client, { chainId: 8453, positionManager: PM, owner: OWNER, targets: [target("3103375", ETH_TEL), target("3104904", ETH_TEL)] });
    expect(plan!.tokenIds).toEqual([3104904n]);
    // Native ETH needs no token reads: it is named for the chain and has 18 decimals.
    expect(plan!.amounts[0]).toEqual({ currency: zeroAddress, symbol: "ETH", decimals: 18, amount: 9n });

    const empty = fakeClient({ "3103375": { liquidity: 0n, fee0: 9n, fee1: 9n } });
    await expect(readCollect(empty, { chainId: 8453, positionManager: PM, owner: OWNER, targets: [target("3103375", ETH_TEL)] })).resolves.toBeNull();
  });

  it("is null when a position with liquidity has earned nothing yet", async () => {
    const client = fakeClient({ "5": { liquidity: 1n, fee0: 0n, fee1: 0n } });
    await expect(readCollect(client, { chainId: 137, positionManager: PM, owner: OWNER, targets: [target("5", WETH_TEL)] })).resolves.toBeNull();
  });

  it("throws when a fee read fails, so nothing is sent on a guess", async () => {
    const client = fakeClient({ "5": { liquidity: 1n, fee0: 1n, fee1: 1n } }, ["5"]);
    await expect(readCollect(client, { chainId: 137, positionManager: PM, owner: OWNER, targets: [target("5", WETH_TEL)] })).rejects.toThrow("Couldn't read the fees of position 5");
  });
});

describe("describeCollect", () => {
  it("names each currency paid, leaving out zeros", () => {
    expect(
      describeCollect([
        { currency: WETH, symbol: "WETH", decimals: 18, amount: 7_123_338_781_727_854n },
        { currency: TEL, symbol: "TEL", decimals: 18, amount: 12_834_540_379_703_370_315_582n },
      ]),
    ).toBe("0.007123 WETH and 12,830 TEL");
    expect(describeCollect([{ currency: TEL, symbol: "TEL", decimals: 18, amount: 0n }])).toBe("nothing");
    expect(
      describeCollect([
        { currency: WETH, symbol: "WETH", decimals: 18, amount: 10n ** 18n },
        { currency: TEL, symbol: "TEL", decimals: 18, amount: 10n ** 18n },
        { currency: EUSD, symbol: "eUSD", decimals: 6, amount: 10n ** 6n },
      ]),
    ).toBe("1 WETH, 1 TEL and 1 eUSD");
  });
});
