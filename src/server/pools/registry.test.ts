/**
 * @jest-environment node
 */
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";

import poolJson from "@/data/pool.json";
import { LEGACY_TEL_ADDRESSES } from "@/lib/tokens";

import {
  GROUPS,
  SUBGRAPH_SOURCES,
  buildRegistry,
  chainConfig,
  fetchedGroups,
  poolIdsFor,
  poolsFor,
  protocolChainOf,
  registryPools,
  rpcPoolsFor,
  type Chain,
  type PoolJsonEntry,
} from "./registry";

const entries = poolJson as PoolJsonEntry[];

/**
 * The pools and subgraph sources the pipeline fetches, pinned so that changing the fetched set is a
 * deliberate edit to pool.json that updates this list in the same change.
 */
const EXPECTED_POOL_IDS: Record<string, string[]> = {
  "uniswap:base": [
    "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b",
    "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6",
    "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982",
    "0xb6d004fca4f9a34197862176485c45ceab7117c86f07422d1fe3d9cfd6e9d1da",
  ],
  "uniswap:polygon": [
    "0x29f94ec9b66df7fe4068e2d7e9bf0147b49afcdc7cd3283dff03088b8026169f",
    "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7",
    "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d",
    "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982",
    "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135",
    "0x9a005a0c12cc2ef01b34e9a7f3fb91a0e6304d377b5479bd3f08f8c29cdf5deb",
    "0xfd56605f7f4620ab44dfc0860d70b9bd1d1f648a5a74558491b39e816a10b99a",
  ],
  "uniswap:ethereum": [
    "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6",
    "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982",
    "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0",
  ],
  "balancer:polygon": [
    "0x3bd8a254163f8328efcc4f8c36da566753462433000200000000000000000dc1",
    "0xe1e09ce7aac2740846d9b6d9d56f588c65314ecb000200000000000000000dbe",
    "0xca6efa5704f1ae445e0ee24d9c3ddde34c5be1c2000200000000000000000dbd",
  ],
  "quickswap:polygon": [
    "0xe88e24f49338f974b528ace10350ac4576c5c8a1",
    "0xfc2fc983a411c4b1e238f7eb949308cf0218c750",
    "0x9b5c71936670e9f1f36e63f03384de7e06e60d2a",
  ],
};

const EXPECTED_SUBGRAPH_IDS: Record<string, string> = {
  "uniswap:base": "Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj",
  "uniswap:polygon": "CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND",
  "uniswap:ethereum": "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G",
  "balancer:polygon": "H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp",
  "quickswap:polygon": "6K19ca6rG5cDS7ZPdfVbEtgUAT3B7wjqTu6wpyXvqNJJ",
};

const idsBySource = () => {
  const out: Record<string, string[]> = {};
  for (const group of GROUPS) {
    const { protocol, chain } = protocolChainOf(group);
    out[`${protocol}:${chain}`] = poolIdsFor(protocol, chain).sort();
  }
  return out;
};

const entry = (attributes: Partial<PoolJsonEntry["attributes"]>): PoolJsonEntry => ({
  attributes: {
    name: "Test pool",
    protocol: "uniswap",
    blockchain: "base",
    pool_address: "0xABC",
    subgraph_id: null,
    active: true,
    fetchSubgraph: true,
    ...attributes,
  },
});

describe("the Uniswap pools the RPC pipeline reads", () => {
  const uniswapEntries = entries.filter(({ attributes }) => attributes.protocol === "uniswap");
  const rpcPools = (["polygon", "base", "ethereum"] as const).flatMap(chain => rpcPoolsFor(chain));

  it("are the active Uniswap pools, three on Polygon and two each on Base and Ethereum", () => {
    expect(rpcPools.map(pool => `${pool.chain}:${pool.id.slice(0, 10)}`).sort()).toEqual([
      "base:0x1266df87",
      "base:0x272e0968",
      "ethereum:0x1266df87",
      "ethereum:0x272e0968",
      "polygon:0x1266df87",
      "polygon:0xa22a3fb3",
      "polygon:0xe604df8f",
    ]);
  });

  it("have a key that hashes to the pool id, an anchor of 0 or 1 and a creation block, on every Uniswap entry", () => {
    for (const { attributes } of uniswapEntries) {
      const key = attributes.key!;
      const id = keccak256(
        encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [
          key.currency0 as `0x${string}`,
          key.currency1 as `0x${string}`,
          key.fee,
          key.tickSpacing,
          key.hooks as `0x${string}`,
        ]),
      );
      expect([attributes.name, id]).toEqual([attributes.name, attributes.pool_address.toLowerCase()]);
      expect([0, 1]).toContain(attributes.anchor);
      expect(Number.isInteger(attributes.createdBlock)).toBe(true);
    }
  });

  it("have every currency priced by a rule of their chain, and every feed a rule names exists", () => {
    for (const pool of rpcPools) {
      const config = chainConfig(pool.chain);
      for (const currency of [pool.key.currency0, pool.key.currency1]) {
        const token = config.tokens[currency];
        expect([pool.chain, currency, Boolean(token)]).toEqual([pool.chain, currency, true]);
        if (token.price.kind === "feed") expect(config.feeds[token.price.feed]).toBeDefined();
      }
      // The anchor is priced without the pool itself: a feed or a fixed price.
      const anchor = config.tokens[pool.anchor === 0 ? pool.key.currency0 : pool.key.currency1];
      expect(anchor.price.kind).not.toBe("fromPools");
    }
  });

  it("have pool.json decimals that match the tokens (TEL3 has 18, legacy TEL 2)", () => {
    const legacyTel = new Set(LEGACY_TEL_ADDRESSES.map(address => address.toLowerCase()));
    const USDC_POLYGON = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
    const known = (chain: Chain, address: string): number | undefined =>
      chainConfig(chain).tokens[address]?.decimals ?? (legacyTel.has(address) ? 2 : address === USDC_POLYGON ? 6 : undefined);

    for (const { attributes } of uniswapEntries) {
      const chain = attributes.blockchain as Chain;
      const decimals = (attributes as { decimals?: { amount0Decimals: number; amount1Decimals: number } }).decimals!;
      const key = attributes.key!;
      expect([attributes.name, decimals.amount0Decimals, decimals.amount1Decimals]).toEqual([
        attributes.name,
        known(chain, key.currency0.toLowerCase()),
        known(chain, key.currency1.toLowerCase()),
      ]);
    }
  });
});

describe("the registry derived from pool.json", () => {
  it("fetches exactly the expected pools per protocol and chain", () => {
    const expected = Object.fromEntries(Object.entries(EXPECTED_POOL_IDS).map(([source, ids]) => [source, [...ids].sort()]));
    expect(idsBySource()).toEqual(expected);
  });

  it("has a subgraph source for every protocol and chain, with the expected ids", () => {
    expect(Object.fromEntries(Object.entries(SUBGRAPH_SOURCES).map(([source, { subgraphId }]) => [source, subgraphId]))).toEqual(EXPECTED_SUBGRAPH_IDS);
  });

  it("takes active from pool.json", () => {
    for (const { attributes } of entries.filter(({ attributes }) => attributes.fetchSubgraph)) {
      const id = (attributes.protocol === "balancer" ? attributes.subgraph_id : attributes.pool_address)!.toLowerCase();
      const pool = registryPools.find(p => p.protocol === attributes.protocol && p.chain === attributes.blockchain && p.id === id);
      expect({ name: attributes.name, active: pool?.active }).toEqual({ name: attributes.name, active: attributes.active });
    }
  });

  it("keeps pools that pool.json lists as inactive, as archived", () => {
    const active = (protocol: "uniswap" | "balancer", chain: "base" | "polygon", id: string) => poolsFor(protocol, chain).find(p => p.id === id)?.active;

    expect(active("uniswap", "base", "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b")).toBe(false);
    expect(active("uniswap", "polygon", "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7")).toBe(false);
    expect(poolsFor("balancer", "polygon").every(p => !p.active)).toBe(true);
  });

  it("fetches every group", () => {
    expect(fetchedGroups()).toEqual([...GROUPS]);
  });

  it("never fetches a subgraph for DFX pools", () => {
    const dfx = entries.filter(({ attributes }) => attributes.protocol === "dfx");
    const fetching = dfx.filter(({ attributes }) => attributes.fetchSubgraph !== false).map(({ attributes }) => attributes.name);

    expect(dfx.length).toBeGreaterThan(0);
    expect(fetching).toEqual([]);
    expect(registryPools.some(pool => (pool.protocol as string) === "dfx")).toBe(false);
  });
});

const KEY = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731",
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000",
};

describe("buildRegistry", () => {
  it("skips pools without fetchSubgraph and lowercases ids", () => {
    expect(buildRegistry([entry({ active: false }), entry({ fetchSubgraph: false, pool_address: "0xdef" })])).toEqual([
      { protocol: "uniswap", chain: "base", id: "0xabc", name: "Test pool", active: false },
    ]);
  });

  it("reads a Uniswap pool's key, anchor and creation block, with lowercase currencies", () => {
    const [pool] = buildRegistry([entry({ key: KEY, anchor: 0, createdBlock: 123 })]);
    expect(pool).toEqual({
      protocol: "uniswap",
      chain: "base",
      id: "0xabc",
      name: "Test pool",
      active: true,
      key: { ...KEY, currency1: KEY.currency1.toLowerCase() },
      anchor: 0,
      createdBlock: 123,
    });
  });

  it("throws for an active Uniswap pool without its key, anchor or creation block", () => {
    expect(() => buildRegistry([entry({ anchor: 0, createdBlock: 1 })])).toThrow("needs key, anchor and createdBlock");
    expect(() => buildRegistry([entry({ key: KEY, createdBlock: 1 })])).toThrow("needs key, anchor and createdBlock");
    expect(() => buildRegistry([entry({ key: KEY, anchor: 1 })])).toThrow("needs key, anchor and createdBlock");
  });

  it("uses subgraph_id as the id for balancer", () => {
    const [pool] = buildRegistry([entry({ protocol: "balancer", blockchain: "polygon", pool_address: "0xaddr", subgraph_id: "0xADDR0002" })]);
    expect(pool.id).toBe("0xaddr0002");
  });

  it("throws for a fetched pool without a subgraph source or without an id", () => {
    expect(() => buildRegistry([entry({ protocol: "dfx", blockchain: "polygon" })])).toThrow("no subgraph source for dfx:polygon");
    expect(() => buildRegistry([entry({ protocol: "balancer", blockchain: "polygon", subgraph_id: null })])).toThrow("no pool id");
  });
});
