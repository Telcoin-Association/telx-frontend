/**
 * @jest-environment node
 */
import {
  applyClaimedAmounts,
  CLAIMED_READ_TIMEOUT_MS,
  MAX_CLAIMED_TOKENS,
  readClaimedAmounts,
  type ClaimedReader,
} from "./merklClaimed";
import { MERKL_DISTRIBUTOR_ADDRESS } from "./merklConstants";
import type { MerklChainRewardsResponse, MerklRewardEntry, MerklToken } from "./merklTypes";

const USER = "0x3b0b1ab7dd8ef487c46f814f56499948961ce5c3";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const TEL_KEY = TEL.toLowerCase();
const OTHER = "0x00000000000000000000000000000000000000bb";
const E18 = 10n ** 18n;

const tel: MerklToken = { chainId: 137, address: TEL, decimals: 18, symbol: "TEL", price: 2 };
const other: MerklToken = { chainId: 137, address: OTHER, decimals: 18, symbol: "OTHER", price: 2 };

/** A reward of `amount` whole tokens with `claimed` of them claimed. */
function reward(amount: bigint, claimed: bigint, token: MerklToken = tel): MerklRewardEntry {
  return {
    amount: (amount * E18).toString(),
    claimed: (claimed * E18).toString(),
    pending: "5",
    proofs: ["0xproof"],
    token,
  };
}

function polygonEntry(
  rewards: MerklRewardEntry[],
  usd: Pick<MerklChainRewardsResponse, "amountUSD" | "claimedUSD"> = {}
): MerklChainRewardsResponse {
  return { chain: { id: 137, name: "Polygon" }, rewards, ...usd };
}

const onPolygon = (claimed: Record<string, bigint>) => ({ 137: claimed });

describe("applyClaimedAmounts", () => {
  it("raises claimed to the onchain amount and leaves amount, pending and proofs alone", () => {
    const [entry] = applyClaimedAmounts([polygonEntry([reward(100n, 40n)])], onPolygon({ [TEL_KEY]: 70n * E18 }));
    expect(entry.rewards[0]).toEqual({ ...reward(100n, 40n), claimed: (70n * E18).toString() });
  });

  it("never lowers claimed", () => {
    const data = [polygonEntry([reward(100n, 60n)], { amountUSD: "200", claimedUSD: "120" })];
    const result = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 40n * E18 }));
    expect(result[0]).toBe(data[0]);
  });

  it("leaves rewards without an onchain amount, and other chains, as they are", () => {
    const polygon = polygonEntry([reward(100n, 40n)]);
    const base = { ...polygonEntry([reward(100n, 40n)]), chain: { id: 8453, name: "Base" } };
    const result = applyClaimedAmounts([polygon, base], onPolygon({ [OTHER]: 70n * E18 }));
    expect(result[0]).toBe(polygon);
    expect(result[1]).toBe(base);
  });

  it("treats a missing or empty claimed as 0", () => {
    const entry = polygonEntry([{ ...reward(100n, 0n), claimed: "" }]);
    const [result] = applyClaimedAmounts([entry], onPolygon({ [TEL_KEY]: 10n * E18 }));
    expect(result.rewards[0].claimed).toBe((10n * E18).toString());
  });

  it("matches token addresses whatever their case", () => {
    const upper = { ...tel, address: `0x${TEL.slice(2).toUpperCase()}` };
    const [entry] = applyClaimedAmounts([polygonEntry([reward(100n, 40n, upper)])], onPolygon({ [TEL_KEY]: 70n * E18 }));
    expect(entry.rewards[0].claimed).toBe((70n * E18).toString());
  });

  it("sets claimedUSD to amountUSD once every reward on the entry is fully claimed", () => {
    const data = [polygonEntry([reward(100n, 40n)], { amountUSD: "200.5", claimedUSD: "80" })];
    const [entry] = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 100n * E18 }));
    expect(entry.claimedUSD).toBe("200.5");
  });

  it("adds the raised amount at the token price to claimedUSD when the entry is partly claimed", () => {
    const data = [polygonEntry([reward(100n, 40n)], { amountUSD: "200", claimedUSD: "80" })];
    const [entry] = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 70n * E18 }));
    expect(entry.claimedUSD).toBe("140");
  });

  it("counts a raised amount no higher than the reward's amount", () => {
    const data = [polygonEntry([reward(100n, 40n), reward(100n, 0n, other)], { amountUSD: "400", claimedUSD: "80" })];
    const [entry] = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 150n * E18 }));
    expect(entry.rewards[0].claimed).toBe((150n * E18).toString());
    expect(entry.claimedUSD).toBe("200");
  });

  it("keeps claimedUSD when the token has no price", () => {
    const unpriced = { ...tel, price: undefined };
    const data = [polygonEntry([reward(100n, 40n, unpriced)], { amountUSD: "200", claimedUSD: "80" })];
    const [entry] = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 70n * E18 }));
    expect(entry.rewards[0].claimed).toBe((70n * E18).toString());
    expect(entry.claimedUSD).toBe("80");
  });

  it("never puts claimedUSD above amountUSD", () => {
    const data = [polygonEntry([reward(100n, 40n), reward(100n, 0n, other)], { amountUSD: "100", claimedUSD: "80" })];
    const [entry] = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 70n * E18 }));
    expect(entry.claimedUSD).toBe("100");
  });

  it("leaves claimedUSD out when the entry has no amountUSD", () => {
    const [entry] = applyClaimedAmounts([polygonEntry([reward(100n, 40n)])], onPolygon({ [TEL_KEY]: 100n * E18 }));
    expect(entry.claimedUSD).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const data = [polygonEntry([reward(100n, 40n)], { amountUSD: "200", claimedUSD: "80" })];
    const before = JSON.parse(JSON.stringify(data));
    const result = applyClaimedAmounts(data, onPolygon({ [TEL_KEY]: 70n * E18 }));
    expect(data).toEqual(before);
    expect(result[0]).not.toBe(data[0]);
  });

  it("returns input that is not an array as it is", () => {
    const body = { error: "unexpected" } as unknown as MerklChainRewardsResponse[];
    expect(applyClaimedAmounts(body, onPolygon({ [TEL_KEY]: 1n }))).toBe(body);
  });
});

describe("readClaimedAmounts", () => {
  const readContract = jest.fn();
  const client = { readContract } as unknown as ClaimedReader;
  const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

  beforeEach(() => readContract.mockReset());
  afterEach(() => jest.useRealTimers());

  it("reads the Distributor's claimed amount for each token, keyed by lowercase address", async () => {
    readContract.mockResolvedValue([123n, 1_700_000_000, `0x${"00".repeat(32)}`]);
    await expect(readClaimedAmounts(client, USER, [TEL])).resolves.toEqual({ claimed: { [TEL_KEY]: 123n }, failures: [] });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: MERKL_DISTRIBUTOR_ADDRESS, functionName: "claimed", args: [USER, TEL_KEY] })
    );
  });

  it("reads each distinct address once, and at most MAX_CLAIMED_TOKENS of them", async () => {
    readContract.mockResolvedValue([1n, 0, `0x${"00".repeat(32)}`]);
    const tokens = [TEL, TEL_KEY, ...Array.from({ length: MAX_CLAIMED_TOKENS + 2 }, (_, i) => address(i + 1))];
    const { claimed } = await readClaimedAmounts(client, USER, tokens);
    expect(readContract).toHaveBeenCalledTimes(MAX_CLAIMED_TOKENS);
    expect(Object.keys(claimed)).toEqual([TEL_KEY, ...Array.from({ length: MAX_CLAIMED_TOKENS - 1 }, (_, i) => address(i + 1))]);
  });

  it("skips values that are not addresses", async () => {
    readContract.mockResolvedValue([1n, 0, `0x${"00".repeat(32)}`]);
    const { claimed } = await readClaimedAmounts(client, USER, ["0x123", "not-an-address", "", TEL]);
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(claimed).toEqual({ [TEL_KEY]: 1n });
  });

  it("returns a rejected read, or one that throws, as a failure and keeps the others", async () => {
    const rejected = new Error("rpc down");
    const thrown = new Error("bad call");
    readContract.mockImplementation(({ args: [, token] }: { args: [string, string] }) => {
      if (token === OTHER) return Promise.reject(rejected);
      if (token === address(1)) throw thrown;
      return Promise.resolve([7n, 0, `0x${"00".repeat(32)}`]);
    });
    await expect(readClaimedAmounts(client, USER, [TEL, OTHER, address(1)])).resolves.toEqual({
      claimed: { [TEL_KEY]: 7n },
      failures: [rejected, thrown],
    });
  });

  it("gives up on a read that never settles after CLAIMED_READ_TIMEOUT_MS and leaves no timer behind", async () => {
    jest.useFakeTimers();
    readContract.mockImplementation(({ args: [, token] }: { args: [string, string] }) =>
      token === OTHER ? new Promise(() => {}) : Promise.resolve([7n, 0, `0x${"00".repeat(32)}`])
    );
    let settled = false;
    const pending = readClaimedAmounts(client, USER, [TEL, OTHER]).finally(() => (settled = true));

    await jest.advanceTimersByTimeAsync(CLAIMED_READ_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const { claimed, failures } = await pending;
    expect(claimed).toEqual({ [TEL_KEY]: 7n });
    expect(failures).toHaveLength(1);
    expect(String(failures[0])).toContain("timed out");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("clears its timers when every read succeeds", async () => {
    jest.useFakeTimers();
    readContract.mockResolvedValue([7n, 0, `0x${"00".repeat(32)}`]);
    await readClaimedAmounts(client, USER, [TEL, OTHER]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
