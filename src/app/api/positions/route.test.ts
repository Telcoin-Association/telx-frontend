/**
 * @jest-environment node
 */
import { fakeMulticall, positionInfoFor, type FakeChainState } from "@/server/positions/testing";

const getBlockNumber = jest.fn();
const getLogs = jest.fn();
const multicall = jest.fn();
const readContract = jest.fn();
jest.mock("../backendHelpers/alchemy", () => {
  const client = {
    getBlockNumber: (...args: unknown[]) => getBlockNumber(...args),
    getLogs: (...args: unknown[]) => getLogs(...args),
    multicall: (...args: unknown[]) => multicall(...args),
    readContract: (...args: unknown[]) => readContract(...args),
  };
  return { publicClientPolygon: client, publicClientBase: client, publicClientEthereum: client };
});

const listOwnedTokenIds = jest.fn();
jest.mock("../backendHelpers/positionTokens", () => ({
  ...jest.requireActual("../backendHelpers/positionTokens"),
  listOwnedTokenIds: (...args: unknown[]) => listOwnedTokenIds(...args),
}));

import { NextRequest } from "next/server";
import { HttpRequestError } from "viem";
import { POLYGON_POSITION_MANAGER } from "@/lib/contracts";
import { clearPositionsCache } from "@/server/positions/service";
import { AlchemyNftError } from "../backendHelpers/positionTokens";
import { GET, maxDuration } from "./route";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";

const request = (query: Record<string, string>) => new NextRequest(`https://telx.network/api/positions?${new URLSearchParams(query)}`);
const log = (tokenId: bigint, from: string, to: string, blockNumber: bigint) => ({ args: { from, to, tokenId }, blockNumber, logIndex: 0 });

function chainState(state: FakeChainState) {
  const fake = fakeMulticall(state);
  multicall.mockImplementation(fake.multicall);
  return fake;
}

// Transfers in the window: token 3 minted to the owner, token 2 sent away. eth_getLogs is filtered by the
// indexed argument, so each query sees only its side.
function recentTransfers() {
  getLogs.mockImplementation(async ({ args }: { args: { from?: string; to?: string } }) => {
    if (args?.to) return [log(3n, ZERO, OWNER, 995n)];
    if (args?.from) return [log(2n, OWNER, OTHER, 996n)];
    return [];
  });
}

beforeEach(() => {
  clearPositionsCache();
  for (const mock of [getBlockNumber, getLogs, multicall, readContract, listOwnedTokenIds]) mock.mockReset();
  getBlockNumber.mockResolvedValue(1_000n);
  getLogs.mockResolvedValue([]);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/positions input validation", () => {
  it.each([
    [{ owner: OWNER }, "Unknown chain"],
    [{ chain: "arbitrum", owner: OWNER }, "Unknown chain"],
    [{ chain: "polygon" }, "Invalid owner"],
    [{ chain: "polygon", owner: "0x123" }, "Invalid owner"],
    [{ chain: "polygon", owner: OWNER, minBlock: "-1" }, "Invalid minBlock"],
    [{ chain: "polygon", owner: OWNER, minBlock: "1e9" }, "Invalid minBlock"],
    [{ chain: "polygon", owner: OWNER, minBlock: "99999999999999" }, "Invalid minBlock"],
  ])("rejects %j with 400 before any upstream call", async (query, message) => {
    const res = await GET(request(query as Record<string, string>));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getBlockNumber).not.toHaveBeenCalled();
    expect(listOwnedTokenIds).not.toHaveBeenCalled();
  });

  it("sets a maxDuration above the token listing budget", () => {
    expect(maxDuration).toBeGreaterThan(15);
  });
});

describe("GET /api/positions", () => {
  it("merges recent transfers into Alchemy's list and keeps only tokens ownerOf confirms", async () => {
    // Alchemy still lists 2 (sent away) and 4 (sent away before the window, so only ownerOf catches it),
    // and does not list 3 yet (minted in the window).
    listOwnedTokenIds.mockResolvedValue({ ids: ["1", "2", "4"], truncated: false });
    recentTransfers();
    const fake = chainState({
      owners: { "1": OWNER, "2": OTHER, "3": OWNER, "4": OTHER },
      info: { "1": positionInfoFor(EUSD_TEL), "2": positionInfoFor(EUSD_TEL), "3": positionInfoFor(EUSD_TEL), "4": positionInfoFor(EUSD_TEL) },
      liquidity: { "1": 1n, "2": 1n, "3": 1n, "4": 1n },
    });

    const res = await GET(request({ chain: "polygon", owner: OWNER }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ chain: "polygon", owner: OWNER, blockNumber: 1000, truncated: false });
    expect(body.pools[EUSD_TEL].positions.map((p: { tokenId: string }) => p.tokenId)).toEqual(["1", "3"]);

    // Token 2 is dropped before any read; 4 is read and dropped by ownerOf.
    const ownerOfReads = fake.batches[0].filter(call => call.functionName === "ownerOf").map(call => String(call.args[0]));
    expect(ownerOfReads).toEqual(["1", "4", "3"]);

    // One getLogs per side over the chain's window, filtered by the owner.
    expect(getLogs).toHaveBeenCalledTimes(2);
    for (const [params] of getLogs.mock.calls) {
      expect(params).toMatchObject({ address: POLYGON_POSITION_MANAGER, fromBlock: 701n, toBlock: 1_000n });
    }
    expect(getLogs.mock.calls.map(([params]) => params.args)).toEqual(
      expect.arrayContaining([{ to: expect.any(String) }, { from: expect.any(String) }]),
    );
  });

  it("passes the owner, a deadline and a transfer-aware count check to the token listing", async () => {
    recentTransfers();
    chainState({ owners: {}, info: {}, liquidity: {} });
    listOwnedTokenIds.mockImplementation(async ({ reconcile, deadline }: { reconcile: (ids: string[]) => Promise<string[]>; deadline: number }) => {
      expect(deadline).toBeGreaterThan(Date.now());
      expect(await reconcile(["1", "2"])).toEqual(["1", "3"]);
      return { ids: [], truncated: false };
    });
    const res = await GET(request({ chain: "polygon", owner: OWNER }));
    expect(res.status).toBe(200);
    expect(listOwnedTokenIds).toHaveBeenCalledWith(expect.objectContaining({ chain: "polygon", contract: POLYGON_POSITION_MANAGER }));
  });

  it("reports a truncated token list", async () => {
    listOwnedTokenIds.mockResolvedValue({ ids: ["1"], truncated: true });
    chainState({ owners: { "1": OWNER }, info: { "1": positionInfoFor(EUSD_TEL) }, liquidity: { "1": 1n } });
    const body = await (await GET(request({ chain: "polygon", owner: OWNER }))).json();
    expect(body.truncated).toBe(true);
    expect(body.pools[EUSD_TEL].positions).toHaveLength(1);
  });

  it("reuses a recent result for the same owner, and reads again when minBlock is newer than it", async () => {
    listOwnedTokenIds.mockResolvedValue({ ids: [], truncated: false });
    chainState({ owners: {}, info: {}, liquidity: {} });

    await GET(request({ chain: "polygon", owner: OWNER }));
    await GET(request({ chain: "polygon", owner: OWNER.toUpperCase().replace("0X", "0x") }));
    await GET(request({ chain: "polygon", owner: OWNER, minBlock: "1000" }));
    expect(listOwnedTokenIds).toHaveBeenCalledTimes(1);

    getBlockNumber.mockResolvedValue(1_001n);
    const body = await (await GET(request({ chain: "polygon", owner: OWNER, minBlock: "1001" }))).json();
    expect(listOwnedTokenIds).toHaveBeenCalledTimes(2);
    expect(body.blockNumber).toBe(1001);
  });

  it("shares one lookup between concurrent requests for the same owner", async () => {
    listOwnedTokenIds.mockResolvedValue({ ids: [], truncated: false });
    chainState({ owners: {}, info: {}, liquidity: {} });
    await Promise.all([GET(request({ chain: "base", owner: OWNER })), GET(request({ chain: "base", owner: OWNER }))]);
    expect(listOwnedTokenIds).toHaveBeenCalledTimes(1);
  });

  it("answers an Alchemy failure with a fixed 502 that is not cached, and does not cache the failure", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    listOwnedTokenIds.mockRejectedValueOnce(new AlchemyNftError("Alchemy getNFTsForOwner responded 429", 429));
    const res = await GET(request({ chain: "polygon", owner: OWNER }));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Position lookup failed" });
    expect(error).toHaveBeenCalled();

    listOwnedTokenIds.mockResolvedValue({ ids: [], truncated: false });
    chainState({ owners: {}, info: {}, liquidity: {} });
    expect((await GET(request({ chain: "polygon", owner: OWNER }))).status).toBe(200);
  });

  it("answers an RPC failure with 502 and logs it without the Alchemy key", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    listOwnedTokenIds.mockResolvedValue({ ids: ["1"], truncated: false });
    multicall.mockRejectedValue(
      new HttpRequestError({ url: "https://polygon-mainnet.g.alchemy.com/v2/SECRETKEY", status: 500, body: {}, details: "boom" }),
    );
    const res = await GET(request({ chain: "polygon", owner: OWNER }));
    expect(res.status).toBe(502);
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("HttpRequestError");
    expect(logged).not.toContain("SECRETKEY");
  });

  it("answers an unexpected failure with a fixed 500", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    listOwnedTokenIds.mockRejectedValue(new TypeError("bug"));
    const res = await GET(request({ chain: "polygon", owner: OWNER }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
