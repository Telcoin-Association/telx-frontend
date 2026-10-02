import type { Address } from "viem";

/**
 * A stand-in for viem's `multicall` over a fake chain state, for tests. It answers each call from
 * `state`, records every batch it receives, and reports a call as failed when the handler throws.
 */
export type FakeChainState = {
  owners: Record<string, string>;
  /** positionInfo word per token id. */
  info: Record<string, bigint>;
  liquidity: Record<string, bigint>;
  subscribed?: Record<string, boolean>;
  unclaimed?: Record<string, bigint>;
  /** Token ids whose registry reads fail. */
  failing?: string[];
  /** Fee growth inside every range, as getFeeGrowthInside returns it; positions start from zero growth. */
  feeGrowth?: readonly [bigint, bigint];
  /** Token ids whose fee reads fail. */
  failingFees?: string[];
};

type Call = { address: Address; functionName: string; args: readonly unknown[] };

export function fakeMulticall(state: FakeChainState) {
  const batches: Call[][] = [];
  const answer = ({ address, functionName, args }: Call): unknown => {
    if (functionName === "getPositionInfo" || functionName === "getFeeGrowthInside") {
      // getPositionInfo(poolId, owner, tickLower, tickUpper, salt): the salt is the token id.
      const id = functionName === "getPositionInfo" ? BigInt(args[4] as string).toString() : null;
      if (id !== null && state.failingFees?.includes(id)) throw new Error(`${functionName} reverted`);
      if (functionName === "getFeeGrowthInside") return state.feeGrowth ?? ([0n, 0n] as const);
      return [state.liquidity[id!] ?? 0n, 0n, 0n] as const;
    }
    const id = String(args[0]);
    if (state.failing?.includes(id) && functionName !== "ownerOf" && functionName !== "positionInfo" && functionName !== "getPositionLiquidity") {
      throw new Error(`${functionName} reverted`);
    }
    switch (functionName) {
      case "ownerOf":
        if (!(id in state.owners)) throw new Error("ERC721: invalid token ID");
        return state.owners[id];
      case "positionInfo":
        return state.info[id] ?? 0n;
      case "getPositionLiquidity":
        return state.liquidity[id] ?? 0n;
      case "isTokenSubscribed":
        return state.subscribed?.[id] ?? false;
      case "getAmountsForLiquidity":
        return [1_500_000n, 2n * 10n ** 18n, 2n ** 96n] as const;
      case "unclaimedRewards":
        return state.unclaimed?.[address.toLowerCase()] ?? 0n;
      default:
        throw new Error(`unexpected read ${functionName}`);
    }
  };
  const multicall = async ({ contracts }: { contracts: Call[] }) => {
    batches.push(contracts);
    return contracts.map(call => {
      try {
        return { status: "success", result: answer(call) };
      } catch (error) {
        return { status: "failure", error };
      }
    });
  };
  return { multicall, batches };
}

/** A positionInfo word whose top 25 bytes are the pool id prefix, with zero ticks and no subscriber. */
export const positionInfoFor = (poolId: string) => BigInt(poolId.slice(0, 52) + "00".repeat(7));
