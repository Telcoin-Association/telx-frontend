import { normalizeMiningContract, miningContractFields } from "./normalizeMiningContracts";
import miningContracts from "../data/pool.json";
import { isMerklUniswapPool } from "../lib/contracts";

const makePool = (
  overrides: Partial<miningContractFields["attributes"]> = {}
): miningContractFields => ({
  id: 1,
  attributes: {
    name: "TEL/WETH",
    protocol: "uniswap",
    network: "polygon",
    blockchain: "polygon",
    pool_address: "0xabc",
    subgraph_id: "",
    rewards_type: "uniswap",
    rewards_interval: null,
    link_add_liquidity: "",
    link_pool_analytics: null,
    link_block_explorer: "",
    staking_period: null,
    notice: null,
    active: true,
    fetchSubgraph: false,
    rewards_tokens: { data: [{ id: 1, attributes: { name: "TEL 500000" } }] },
    stake_addresses: { data: [] },
    pool_assets: {
      data: [
        { id: 1, attributes: { name: "TEL" } },
        { id: 2, attributes: { name: "WETH" } },
      ],
    },
    ...overrides,
  },
});

describe("normalizeMiningContract", () => {
  it("derives deprecated from active when not set", () => {
    const live = normalizeMiningContract(makePool({ active: true }));
    expect(live.active).toBe(true);
    expect(live.deprecated).toBe(false);

    const retired = normalizeMiningContract(makePool({ active: false }));
    expect(retired.active).toBe(false);
    expect(retired.deprecated).toBe(true);
  });

  it("explicit deprecated keeps the pool active", () => {
    const result = normalizeMiningContract(makePool({ active: true, deprecated: true }));
    expect(result.active).toBe(true);
    expect(result.deprecated).toBe(true);
  });

  it("explicit deprecated false is respected", () => {
    const result = normalizeMiningContract(makePool({ active: false, deprecated: false }));
    expect(result.active).toBe(false);
    expect(result.deprecated).toBe(false);
  });

  it("pool.json marks the old TEL2 Polygon pools deprecated but active", () => {
    const pools = miningContracts as unknown as miningContractFields[];
    const deprecated = pools.filter((pool) => pool.attributes.deprecated === true);

    expect(new Set(deprecated.map((pool) => pool.attributes.pool_address))).toEqual(
      new Set([
        "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7",
        "0x29f94ec9b66df7fe4068e2d7e9bf0147b49afcdc7cd3283dff03088b8026169f",
        "0x3bd8a254163f8328efcc4f8c36da566753462433",
        "0xca6efa5704f1ae445e0ee24d9c3ddde34c5be1c2",
        "0xe1e09ce7aac2740846d9b6d9d56f588c65314ecb",
      ])
    );
    expect(deprecated).toHaveLength(5);
    deprecated.forEach((pool) => expect(pool.attributes.active).toBe(true));
  });

  it("pool.json uses the 18-decimal TEL on every Merkl TEL pool", () => {
    const pools = miningContracts as unknown as miningContractFields[];
    const merklTelPools = pools.filter(
      (pool) =>
        pool.attributes.protocol === "uniswap" &&
        isMerklUniswapPool(pool.attributes.pool_address) &&
        pool.attributes.pool_assets.data.some((asset) => asset.attributes.name === "TEL")
    );

    expect(merklTelPools).toHaveLength(6);
    merklTelPools.forEach((pool) => {
      // TEL is currency1 in each of these pools
      expect(pool.attributes.pool_assets.data[1].attributes.name).toBe("TEL");
      expect(pool.attributes.decimals?.amount1Decimals).toBe(18);
    });
  });
});
