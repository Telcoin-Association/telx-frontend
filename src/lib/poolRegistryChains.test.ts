import pools from "../data/pool.json";
import { RPC_CHAINS } from "./rpc";

// Chain lookups for positions, contracts and transactions fall back to Polygon for a name they do not know,
// so a new or misspelt chain in the registry would read and write that pool on Polygon. This keeps every
// Uniswap pool's chain to the names they all know.
describe("pool registry chains", () => {
  it("names every Uniswap pool's chain with a value the chain lookups know", () => {
    const unknown = (pools as { attributes?: { protocol?: string; blockchain?: string; pool_address?: string } }[])
      .map((pool) => pool.attributes)
      .filter((attributes) => attributes?.protocol === "uniswap")
      .filter((attributes) => !(RPC_CHAINS as readonly string[]).includes(attributes?.blockchain ?? ""))
      .map((attributes) => `${attributes?.pool_address}: ${attributes?.blockchain}`);
    expect(unknown).toEqual([]);
  });
});
