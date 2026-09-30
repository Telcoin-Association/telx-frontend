/**
 * @jest-environment node
 */
import ethereumPage from "./__fixtures__/opportunities-ethereum.json";
import polygonPage from "./__fixtures__/opportunities-polygon.json";
import { MAX_PAGES, OpportunitiesPageSchema, PAGE_SIZE, fetchOpportunities, opportunitiesUrl } from "./fetch";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch double answering each call with the next body in `pages`. */
function fakeFetch(...pages: unknown[]) {
  const fn = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  for (const page of pages) fn.mockResolvedValueOnce(page instanceof Response ? page : jsonResponse(page));
  return fn;
}

describe("OpportunitiesPageSchema", () => {
  it("parses a live Polygon response, turning campaign times into unix ms", () => {
    const parsed = OpportunitiesPageSchema.parse(polygonPage);

    expect(parsed).toHaveLength(3);
    expect(parsed[1]).toEqual({
      id: "13504248474540896351",
      identifier: "0x10bc98E9459C8E746d08Cdf09aFe31a08830de0D",
      chainId: 137,
      type: "UNISWAP_V4_SUBSCRIPTION",
      status: "LIVE",
      apr: expect.any(Number),
      dailyRewards: expect.any(Number),
      tvl: expect.any(Number),
      aprRecord: { breakdowns: [expect.objectContaining({ type: "CAMPAIGN", distributionType: "DUTCH_AUCTION" })] },
      latestCampaignStart: 1_790_294_400_000,
      latestCampaignEnd: 1_790_899_200_000,
    });
  });

  it("parses a PAST opportunity without campaign times", () => {
    const [past] = OpportunitiesPageSchema.parse(ethereumPage);

    expect(past).toMatchObject({ status: "PAST", latestCampaignStart: null, latestCampaignEnd: null, aprRecord: { breakdowns: [] } });
  });

  it("drops unknown fields, tolerates missing optional ones and keeps an unknown status", () => {
    const [opportunity] = OpportunitiesPageSchema.parse([
      {
        id: "1",
        identifier: "0xabc",
        chainId: 1,
        type: "UNISWAP_V4_SUBSCRIPTION",
        status: "PAUSED",
        apr: null,
        dailyRewards: 0,
        tvl: 5,
        extra: { a: 1 },
      },
    ]);

    expect(opportunity).toEqual({
      id: "1",
      identifier: "0xabc",
      chainId: 1,
      type: "UNISWAP_V4_SUBSCRIPTION",
      status: "PAUSED",
      apr: null,
      dailyRewards: 0,
      tvl: 5,
      latestCampaignStart: null,
      latestCampaignEnd: null,
    });
  });

  it("reads numeric and zero campaign times", () => {
    const [opportunity] = OpportunitiesPageSchema.parse([
      {
        id: "1",
        identifier: "0xabc",
        chainId: 1,
        type: "T",
        status: "LIVE",
        apr: 1,
        dailyRewards: 1,
        tvl: 1,
        latestCampaignStart: 10,
        latestCampaignEnd: "0",
      },
    ]);

    expect(opportunity).toMatchObject({ latestCampaignStart: 10_000, latestCampaignEnd: null });
  });

  it("reads a campaign time in the wrong unit, which no date can hold, as unset", () => {
    const base = { id: "1", identifier: "0xabc", chainId: 1, type: "T", status: "LIVE", apr: 1, dailyRewards: 1, tvl: 1 };
    const [microseconds, milliseconds, seconds] = OpportunitiesPageSchema.parse([
      { ...base, latestCampaignStart: "1790294400", latestCampaignEnd: "1790899200000000" },
      { ...base, latestCampaignStart: 1_790_294_400_000, latestCampaignEnd: null },
      { ...base, latestCampaignStart: 1_790_294_400, latestCampaignEnd: 1_790_899_200 },
    ]);

    expect(microseconds).toMatchObject({ latestCampaignStart: 1_790_294_400_000, latestCampaignEnd: null });
    expect(milliseconds).toMatchObject({ latestCampaignStart: null });
    expect(seconds).toMatchObject({ latestCampaignStart: 1_790_294_400_000, latestCampaignEnd: 1_790_899_200_000 });
  });

  it("rejects an opportunity without an identifier", () => {
    expect(OpportunitiesPageSchema.safeParse([{ id: "1", chainId: 1, type: "T", status: "LIVE", apr: 1, dailyRewards: 1, tvl: 1 }]).success).toBe(
      false,
    );
  });
});

describe("fetchOpportunities", () => {
  it("asks for the chain's subscription opportunities, a full page at a time", () => {
    const url = new URL(opportunitiesUrl("base", 2));

    expect(url.origin + url.pathname).toBe("https://api.merkl.xyz/v4/opportunities/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ chainId: "8453", type: "UNISWAP_V4_SUBSCRIPTION", items: String(PAGE_SIZE), page: "2" });
  });

  it("returns a single short page", async () => {
    const fetchImpl = fakeFetch(polygonPage);

    await expect(fetchOpportunities("polygon", fetchImpl)).resolves.toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list for a chain with no opportunities", async () => {
    await expect(fetchOpportunities("base", fakeFetch([]))).resolves.toEqual([]);
  });

  it("reads pages until a short one", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ ...polygonPage[0], id: String(i) }));
    const fetchImpl = fakeFetch(full, polygonPage);

    await expect(fetchOpportunities("polygon", fetchImpl)).resolves.toHaveLength(PAGE_SIZE + 3);
    expect(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.get("page")).toBe("1");
  });

  it("throws rather than return a truncated list after MAX_PAGES full pages", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ ...polygonPage[0], id: String(i) }));
    const fetchImpl = fakeFetch(...Array.from({ length: MAX_PAGES }, () => full));

    await expect(fetchOpportunities("polygon", fetchImpl)).rejects.toThrow(`more than ${MAX_PAGES} pages`);
  });

  it("throws on an HTTP error", async () => {
    await expect(fetchOpportunities("polygon", fakeFetch(jsonResponse({ error: "down" }, 503)))).rejects.toThrow("Merkl polygon: HTTP 503 on page 0");
  });

  it("throws on a response that fails validation", async () => {
    await expect(fetchOpportunities("polygon", fakeFetch({ not: "an array" }))).rejects.toThrow("Merkl polygon: invalid opportunities on page 0");
  });
});
