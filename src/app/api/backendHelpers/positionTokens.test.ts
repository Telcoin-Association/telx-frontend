/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { alchemyNftUrl } from "./alchemy";
import { AlchemyNftError, NFT_MAX_ATTEMPTS, NFT_MAX_PAGES, NFT_PAGE_SIZE, listOwnedTokenIds } from "./positionTokens";

const OWNER = "0x00000000000000000000000000000000000000aa";
const POSITION_MANAGER = "0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9";
const OTHER_CONTRACT = "0x0000000000000000000000000000000000000bad";

const nft = (tokenId: string, contractAddress = POSITION_MANAGER) => ({ contractAddress, tokenId, balance: "1", isSpam: false });
const page = (tokenIds: string[], pageKey: string | null = null) => ({ ownedNfts: tokenIds.map((id) => nft(id)), totalCount: tokenIds.length, pageKey });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFetch(...bodies: unknown[]) {
  const fetchImpl = jest.fn();
  for (const body of bodies) fetchImpl.mockResolvedValueOnce(json(body));
  return fetchImpl;
}

const list = (fetchImpl: jest.Mock) => listOwnedTokenIds({ chain: "polygon", owner: OWNER, contract: POSITION_MANAGER, fetchImpl });
const listChecked = (fetchImpl: jest.Mock, expectedCount: () => Promise<number>) =>
  listOwnedTokenIds({ chain: "polygon", owner: OWNER, contract: POSITION_MANAGER, fetchImpl, expectedCount, retryDelayMs: 0 });
const requestUrl = (fetchImpl: jest.Mock, call: number) => new URL(fetchImpl.mock.calls[call][0] as string);

beforeAll(() => {
  process.env.ALCHEMY_ID = "test-key";
});

describe("alchemyNftUrl", () => {
  it("builds the NFT API v3 endpoint for the chain", () => {
    expect(alchemyNftUrl("polygon", "getNFTsForOwner")).toBe("https://polygon-mainnet.g.alchemy.com/nft/v3/test-key/getNFTsForOwner");
  });
});

describe("listOwnedTokenIds", () => {
  it("returns the ids of a single page in order", async () => {
    const fetchImpl = mockFetch(page(["65602", "12", "7"]));
    await expect(list(fetchImpl)).resolves.toEqual({ ids: ["65602", "12", "7"], truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends owner, contract filter, no metadata and the page size to the v3 endpoint", async () => {
    const fetchImpl = mockFetch(page(["1"]));
    await list(fetchImpl);
    const raw = fetchImpl.mock.calls[0][0] as string;
    const url = new URL(raw);
    expect(`${url.origin}${url.pathname}`).toBe("https://polygon-mainnet.g.alchemy.com/nft/v3/test-key/getNFTsForOwner");
    expect(raw).toContain(`contractAddresses%5B%5D=${POSITION_MANAGER}`);
    expect(url.searchParams.get("owner")).toBe(OWNER);
    expect(url.searchParams.get("withMetadata")).toBe("false");
    expect(url.searchParams.get("pageSize")).toBe(String(NFT_PAGE_SIZE));
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(url.searchParams.has("pageKey")).toBe(false);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Origin: expect.any(String) } });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("follows pageKey across pages", async () => {
    const fetchImpl = mockFetch(page(["1", "2"], "next-page-key"), page(["3"]));
    await expect(list(fetchImpl)).resolves.toEqual({ ids: ["1", "2", "3"], truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestUrl(fetchImpl, 1).searchParams.get("pageKey")).toBe("next-page-key");
  });

  it("stops at NFT_MAX_PAGES when pageKey never ends and warns once", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    let call = 0;
    const fetchImpl = jest.fn(async () => json(page([String(++call)], "forever")));
    try {
      const { ids, truncated } = await list(fetchImpl);
      expect(truncated).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(NFT_MAX_PAGES);
      expect(ids).toHaveLength(NFT_MAX_PAGES);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(OWNER);
      expect(warn.mock.calls[0][0]).toContain("polygon");
    } finally {
      warn.mockRestore();
    }
  });

  it("drops other contracts, matches addresses case-insensitively and deduplicates", async () => {
    const fetchImpl = mockFetch({
      ownedNfts: [nft("5"), nft("6", OTHER_CONTRACT), nft("7", POSITION_MANAGER.toLowerCase()), nft("5"), nft("0x8"), nft("")],
      pageKey: null,
    });
    await expect(list(fetchImpl)).resolves.toEqual({ ids: ["5", "7"], truncated: false });
  });

  it("throws AlchemyNftError with the status on a non-2xx response", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({ error: "limit" }, 429));
    const error = await list(fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AlchemyNftError);
    expect(error).toMatchObject({ status: 429, message: "Alchemy getNFTsForOwner responded 429" });
  });

  it("throws AlchemyNftError when the body has no ownedNfts or is not JSON", async () => {
    await expect(list(mockFetch({ totalCount: 0 }))).rejects.toMatchObject({ name: "AlchemyNftError", status: null });
    const html = jest.fn().mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    await expect(list(html)).rejects.toMatchObject({ name: "AlchemyNftError", status: null });
  });

  it("wraps a rejecting fetch in AlchemyNftError", async () => {
    const fetchImpl = jest.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    const error = await list(fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AlchemyNftError);
    expect(error).toMatchObject({ status: null });
    expect((error as Error).message).toContain("fetch failed");
  });

  describe("with expectedCount", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
    });

    it("fetches again when the list is short and returns the complete one", async () => {
      const fetchImpl = mockFetch(page(["1", "2"]), page(["1", "2", "3"]));
      const expectedCount = jest.fn().mockResolvedValue(3);
      await expect(listChecked(fetchImpl, expectedCount)).resolves.toEqual({ ids: ["1", "2", "3"], truncated: false });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(expectedCount).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it("stops after NFT_MAX_ATTEMPTS short lists, warns once and returns the longest", async () => {
      // Attempts 2 and 3 tie at two ids, so the later one wins; the fourth, complete body is never requested.
      const fetchImpl = mockFetch(page(["1"]), page(["1", "2"]), page(["2", "3"]), page(["1", "2", "3", "4"]));
      const expectedCount = jest.fn().mockResolvedValue(4);
      await expect(listChecked(fetchImpl, expectedCount)).resolves.toEqual({ ids: ["2", "3"], truncated: false });
      expect(fetchImpl).toHaveBeenCalledTimes(NFT_MAX_ATTEMPTS);
      expect(expectedCount).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("2 of 4 tokens");
      expect(warn.mock.calls[0][0]).toContain(OWNER);
      expect(warn.mock.calls[0][0]).toContain("polygon");
    });

    it("returns the first list with a warning when the count check rejects", async () => {
      const fetchImpl = mockFetch(page(["1"]), page(["1", "2"]));
      const expectedCount = jest.fn().mockRejectedValue(new Error("rpc down"));
      await expect(listChecked(fetchImpl, expectedCount)).resolves.toEqual({ ids: ["1"], truncated: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("rpc down");
      expect(warn.mock.calls[0][0]).toContain(OWNER);
      expect(warn.mock.calls[0][0]).toContain("polygon");
    });

    it("enumerates once when expectedCount is absent", async () => {
      const fetchImpl = mockFetch(page(["1"]), page(["1", "2"]));
      await expect(list(fetchImpl)).resolves.toEqual({ ids: ["1"], truncated: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it("returns the list it has, with a warning, when a retry throws AlchemyNftError", async () => {
      const fetchImpl = jest.fn().mockResolvedValueOnce(json(page(["1", "2"]))).mockResolvedValueOnce(json({ error: "limit" }, 429));
      const expectedCount = jest.fn().mockResolvedValue(3);
      await expect(listChecked(fetchImpl, expectedCount)).resolves.toEqual({ ids: ["1", "2"], truncated: false });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("429");
      expect(warn.mock.calls[0][0]).toContain(OWNER);
    });

    it("skips the count check and the retries when the listing hits NFT_MAX_PAGES", async () => {
      const fetchImpl = jest.fn(async () => json(page(["1"], "forever")));
      const expectedCount = jest.fn().mockResolvedValue(5000);
      const result = await listChecked(fetchImpl, expectedCount);
      expect(result).toEqual({ ids: ["1"], truncated: true });
      expect(fetchImpl).toHaveBeenCalledTimes(NFT_MAX_PAGES);
      expect(expectedCount).not.toHaveBeenCalled();
    });
  });

  describe("with a deadline", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
    });

    // A clock that advances by `step` milliseconds on every fetch.
    function steppingClock(step: number) {
      let time = 0;
      const fetchImpl = jest.fn(async () => {
        time += step;
        return json(page([String(time)], "more"));
      });
      return { fetchImpl, now: () => time };
    }

    it("stops paging at the deadline and marks the list truncated", async () => {
      const { fetchImpl, now } = steppingClock(1_000);
      const expectedCount = jest.fn().mockResolvedValue(100);
      const result = await listOwnedTokenIds({
        chain: "polygon",
        owner: OWNER,
        contract: POSITION_MANAGER,
        fetchImpl,
        expectedCount,
        now,
        deadline: 3_000,
      });
      expect(result).toEqual({ ids: ["1000", "2000", "3000"], truncated: true });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(expectedCount).not.toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toContain("ran out of time");
    });

    it("caps each page's timeout by the time left", async () => {
      const timeout = jest.spyOn(AbortSignal, "timeout");
      const fetchImpl = mockFetch(page(["1"]));
      await listOwnedTokenIds({ chain: "polygon", owner: OWNER, contract: POSITION_MANAGER, fetchImpl, now: () => 0, deadline: 2_500 });
      expect(timeout).toHaveBeenCalledWith(2_500);
      timeout.mockRestore();
    });

    it("throws rather than returning an empty list when no time is left for the first page", async () => {
      const fetchImpl = mockFetch(page(["1"]));
      await expect(
        listOwnedTokenIds({ chain: "polygon", owner: OWNER, contract: POSITION_MANAGER, fetchImpl, now: () => 10, deadline: 10 }),
      ).rejects.toBeInstanceOf(AlchemyNftError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("does not start a retry once the deadline has passed", async () => {
      let time = 0;
      const fetchImpl = jest.fn(async () => {
        time += 5_000;
        return json(page(["1"]));
      });
      const expectedCount = jest.fn().mockResolvedValue(2);
      const result = await listOwnedTokenIds({
        chain: "polygon",
        owner: OWNER,
        contract: POSITION_MANAGER,
        fetchImpl,
        expectedCount,
        retryDelayMs: 0,
        now: () => time,
        deadline: 5_000,
      });
      expect(result).toEqual({ ids: ["1"], truncated: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("1 of 2 tokens");
    });
  });
});
