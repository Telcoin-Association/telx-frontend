import miningContracts from "./pool.json";
import registry from "./backend-pools.json";
import type { miningContractFields } from "../helpers/normalizeMiningContracts";

// pool.json drives the UI; backend-pools.json is a copy of the backend registry
// (npm run sync:pools). The backend only fetches subgraph data for registry pools,
// so the pools pool.json expects subgraph data for must be exactly that set.

const SUBGRAPH_PROTOCOLS = ["uniswap", "balancer", "quickswap"];

type Entry = { name: string; active: boolean };

const keyOf = (protocol: string, chain: string, id: string) =>
  `${protocol}:${chain}:${id}`.toLowerCase();

const pools = miningContracts as unknown as miningContractFields[];

const fromPoolJson = new Map<string, Entry>(
  pools
    .filter(
      ({ attributes }) =>
        SUBGRAPH_PROTOCOLS.includes(attributes.protocol ?? "") && attributes.fetchSubgraph === true
    )
    .map(({ attributes }) => {
      const id = attributes.protocol === "balancer" ? attributes.subgraph_id : attributes.pool_address;
      return [
        keyOf(attributes.protocol!, attributes.blockchain, id ?? ""),
        { name: attributes.name, active: attributes.active },
      ];
    })
);

const fromRegistry = new Map<string, Entry>(
  registry.pools.map((pool) => [
    keyOf(pool.protocol, pool.chain, pool.id),
    { name: pool.name, active: pool.active },
  ])
);

const describeKey = (key: string, entry: Entry) => `${entry.name} (${key})`;

describe("pool.json and the backend pool registry", () => {
  it("agree on which pools have subgraph data", () => {
    const onlyInPoolJson = [...fromPoolJson]
      .filter(([key]) => !fromRegistry.has(key))
      .map(([key, entry]) => describeKey(key, entry));
    const onlyInRegistry = [...fromRegistry]
      .filter(([key]) => !fromPoolJson.has(key))
      .map(([key, entry]) => describeKey(key, entry));

    expect({ onlyInPoolJson, onlyInRegistry }).toEqual({ onlyInPoolJson: [], onlyInRegistry: [] });
    expect(fromPoolJson.size).toBeGreaterThan(0);
  });

  it("agree on which pools are active", () => {
    const mismatched = [...fromPoolJson]
      .filter(([key, entry]) => fromRegistry.has(key) && fromRegistry.get(key)!.active !== entry.active)
      .map(
        ([key, entry]) =>
          `${describeKey(key, entry)}: pool.json active=${entry.active}, registry active=${fromRegistry.get(key)!.active}`
      );

    expect(mismatched).toEqual([]);
  });

  it("never fetches a subgraph for DFX pools", () => {
    const dfx = pools.filter(({ attributes }) => attributes.protocol === "dfx");
    const fetching = dfx
      .filter(({ attributes }) => attributes.fetchSubgraph !== false)
      .map(({ id, attributes }) => `${attributes.name} (id ${id}, ${attributes.pool_address})`);

    expect(dfx.length).toBeGreaterThan(0);
    expect(fetching).toEqual([]);
  });
});
