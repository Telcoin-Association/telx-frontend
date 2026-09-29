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
};

type Call = { address: Address; functionName: string; args: readonly unknown[] };

export function fakeMulticall(state: FakeChainState) {
  const batches: Call[][] = [];
  const answer = ({ address, functionName, args }: Call): unknown => {
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
