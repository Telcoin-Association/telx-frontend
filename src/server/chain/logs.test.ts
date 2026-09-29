/**
 * @jest-environment node
 */
import { getLogs, isRangeError, isRateLimitError, readLogChunks, suggestedSpan, type RawLog } from "./logs";

const FILTER = { address: "0x0000000000000000000000000000000000000001", topics: [] } as const;

const raw = (block: number, logIndex: number, extra: Partial<RawLog> = {}): RawLog => ({
  address: FILTER.address,
  blockNumber: `0x${block.toString(16)}`,
  blockHash: "0x00",
  blockTimestamp: `0x${(1_000 + block).toString(16)}`,
  transactionHash: "0xaa",
  logIndex: `0x${logIndex.toString(16)}`,
  data: "0x",
  topics: [],
  ...extra,
});

const ALCHEMY_RANGE_ERROR =
  "Log response size exceeded. You can make eth_getLogs requests with up to a 2,000 block range and no limit on the response size, or you can request any block range with a cap of 10K logs in the response. Based on your parameters and the response size limit, this block range should work: [0x64, 0x95]";

/** A client whose getLogs refuses any range wider than `maxSpan`, with Alchemy's message. */
function rangeLimitedClient(maxSpan: number, message = ALCHEMY_RANGE_ERROR) {
  const ranges: [number, number][] = [];
  const request = jest.fn(async ({ params }: { method: string; params?: unknown }) => {
    const [{ fromBlock, toBlock }] = params as [{ fromBlock: string; toBlock: string }];
    const from = Number.parseInt(fromBlock, 16);
    const to = Number.parseInt(toBlock, 16);
    if (to - from + 1 > maxSpan) throw Object.assign(new Error("RPC Request failed."), { details: message });
    ranges.push([from, to]);
    return [raw(to, 0)];
  });
  return { client: { request }, ranges };
}

async function collect(iterable: AsyncIterable<{ fromBlock: number; toBlock: number }>) {
  const chunks: [number, number][] = [];
  for await (const chunk of iterable) chunks.push([chunk.fromBlock, chunk.toBlock]);
  return chunks;
}

describe("getLogs", () => {
  it("parses positions and times, keeps the removed flag, and sorts by block and log index", async () => {
    const client = { request: jest.fn(async () => [raw(5, 1), raw(4, 2, { removed: true }), raw(5, 0, { blockTimestamp: null })]) };

    const logs = await getLogs(client, FILTER, 1, 9);

    expect(logs.map(log => [log.blockNumber, log.logIndex, log.blockTimestamp, log.removed])).toEqual([
      [4, 2, 1004, true],
      [5, 0, null, false],
      [5, 1, 1005, false],
    ]);
    expect(client.request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [{ address: FILTER.address, topics: [], fromBlock: "0x1", toBlock: "0x9" }],
    });
  });
});

describe("range errors", () => {
  it("recognizes size refusals and reads the suggested span", () => {
    const error = Object.assign(new Error("RPC Request failed."), { details: ALCHEMY_RANGE_ERROR });
    expect(isRangeError(error)).toBe(true);
    expect(suggestedSpan(error)).toBe(0x95 - 0x64 + 1);
    expect(isRangeError(new Error("query returned more than 10000 results"))).toBe(true);
    expect(isRangeError(new Error("execution reverted"))).toBe(false);
    expect(suggestedSpan(new Error("block range too large"))).toBeNull();
  });
});

describe("readLogChunks", () => {
  it("reads the whole range in one call when the node accepts it", async () => {
    const { client, ranges } = rangeLimitedClient(1_000);
    expect(await collect(readLogChunks(client, FILTER, 10, 509, { maxSpan: 1_000 }))).toEqual([[10, 509]]);
    expect(ranges).toEqual([[10, 509]]);
  });

  it("splits a refused range to the node's suggested span and covers every block once", async () => {
    const { client } = rangeLimitedClient(50);
    const chunks = await collect(readLogChunks(client, FILTER, 0, 199, { maxSpan: 1_000 }));

    expect(chunks[0]).toEqual([0, 49]);
    expect(chunks.at(-1)?.[1]).toBe(199);
    chunks.forEach(([from], i) => i > 0 && expect(from).toBe(chunks[i - 1][1] + 1));
  });

  it("halves the span when the refusal suggests none, and never exceeds maxSpan", async () => {
    const { client, ranges } = rangeLimitedClient(30, "block range is too wide");
    const chunks = await collect(readLogChunks(client, FILTER, 0, 99, { maxSpan: 64 }));

    expect(chunks[0]).toEqual([0, 15]);
    expect(chunks.at(-1)?.[1]).toBe(99);
    expect(ranges.every(([from, to]) => to - from + 1 <= 30)).toBe(true);
  });

  it("retries a rate-limited call with the same range instead of splitting it, then gives up", async () => {
    const limited = () => Object.assign(new Error("RPC Request failed."), { details: "Your app has exceeded its compute units per second capacity" });
    const request = jest
      .fn()
      .mockRejectedValueOnce(limited())
      .mockRejectedValueOnce(new Error("HTTP 429 Too Many Requests"))
      .mockResolvedValue([raw(99, 0)]);

    expect(await collect(readLogChunks({ request }, FILTER, 0, 99, { maxSpan: 100, rateLimitDelaysMs: [0, 0] }))).toEqual([[0, 99]]);
    const ranges = request.mock.calls.map(([{ params }]) => [params[0].fromBlock, params[0].toBlock]);
    expect(ranges).toEqual([
      ["0x0", "0x63"],
      ["0x0", "0x63"],
      ["0x0", "0x63"],
    ]);

    const always = { request: jest.fn(async () => Promise.reject(limited())) };
    await expect(collect(readLogChunks(always, FILTER, 0, 99, { maxSpan: 100, rateLimitDelaysMs: [0] }))).rejects.toThrow("RPC Request failed.");
    expect(always.request).toHaveBeenCalledTimes(2);
  });

  it("tells a rate limit from a size refusal", () => {
    expect(isRateLimitError(new Error("HTTP 429"))).toBe(true);
    expect(isRangeError(new Error("capacity limit exceeded"))).toBe(false);
    expect(isRateLimitError(new Error("block range is too wide"))).toBe(false);
  });

  it("throws other errors, and a size refusal of a single block", async () => {
    const failing = { request: jest.fn(async () => Promise.reject(new Error("execution reverted"))) };
    await expect(collect(readLogChunks(failing, FILTER, 0, 9, { maxSpan: 10 }))).rejects.toThrow("execution reverted");
    expect(failing.request).toHaveBeenCalledTimes(1);

    const { client } = rangeLimitedClient(0, "block range too large");
    await expect(collect(readLogChunks(client, FILTER, 0, 3, { maxSpan: 4 }))).rejects.toThrow("RPC Request failed.");
  });
});
