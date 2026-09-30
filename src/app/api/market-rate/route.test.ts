/**
 * @jest-environment node
 */
import axios from "axios";
import { GET } from "./route";

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("../../../server/pools/redis", () => ({ getRedis: () => ({}) }));
const mockPipelineRates = jest.fn();
jest.mock("../../../server/pools/rpc/pipelineRates", () => ({ pipelineRates: (...args: unknown[]) => mockPipelineRates(...args) }));

const get = axios.get as jest.Mock;
const request = () => new Request("https://telx.network/api/market-rate");

beforeEach(() => {
  get.mockReset();
  mockPipelineRates.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /api/market-rate", () => {
  it("adds the pipeline's eUSD and eMXN rates to the Telcoin rates", async () => {
    get.mockResolvedValue({ data: { TEL: { USD: "0.002322" } } });
    mockPipelineRates.mockResolvedValue({ EUSD: { USD: "1" }, EMXN: { USD: "0.0548" } });
    const res = await GET(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ TEL: { USD: "0.002322" }, EUSD: { USD: "1" }, EMXN: { USD: "0.0548" } });
  });

  it("serves the Telcoin rates alone when the pipeline rates cannot be read", async () => {
    get.mockResolvedValue({ data: { TEL: { USD: "0.002322" } } });
    mockPipelineRates.mockRejectedValue(new Error("redis down"));
    const res = await GET(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ TEL: { USD: "0.002322" } });
  });

  it("keeps a Telcoin rate over the pipeline's for the same ticker", async () => {
    get.mockResolvedValue({ data: { EUSD: { USD: "0.999" } } });
    mockPipelineRates.mockResolvedValue({ EUSD: { USD: "1" } });
    await expect((await GET(request())).json()).resolves.toEqual({ EUSD: { USD: "0.999" } });
  });

  it("still fails with 500 when the Telcoin rates API fails", async () => {
    get.mockRejectedValue(new Error("upstream down"));
    mockPipelineRates.mockResolvedValue({ EUSD: { USD: "1" } });
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
