/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

const reads = { ethereum: jest.fn(), base: jest.fn(), polygon: jest.fn() };
jest.mock("../backendHelpers/alchemy", () => ({
  publicClientEthereum: { readContract: (...args: unknown[]) => reads.ethereum(...args) },
  publicClientBase: { readContract: (...args: unknown[]) => reads.base(...args) },
  publicClientPolygon: { readContract: (...args: unknown[]) => reads.polygon(...args) },
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const USER = "0x00000000000000000000000000000000000000aa";
const request = (userAddress?: string) =>
  new NextRequest(`https://telx.network/api/uniswap-user-rewards${userAddress === undefined ? "" : `?userAddress=${userAddress}`}`);

beforeEach(() => {
  Object.values(reads).forEach((read) => read.mockReset());
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/uniswap-user-rewards", () => {
  it.each([undefined, "", "0x123", "not-an-address"])("returns 400 for userAddress %p without reading the chain", async (userAddress) => {
    const res = await GET(request(userAddress));
    expect(res.status).toBe(400);
    Object.values(reads).forEach((read) => expect(read).not.toHaveBeenCalled());
  });

  it("returns each chain's amount, and null for a chain whose read failed", async () => {
    reads.ethereum.mockResolvedValue(12345n);
    reads.base.mockResolvedValue(0n);
    reads.polygon.mockRejectedValue(new Error("rpc down"));

    const res = await GET(request(USER));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimableAmount: { ethereum: "123.45", base: "0", polygon: null } });
  });
});
