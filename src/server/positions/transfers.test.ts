/**
 * @jest-environment node
 */
import type { PositionTransfer } from "@/lib/positions";
import { applyTransfers, transferWindow } from "./transfers";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";

const transfer = (tokenId: string, from: string, to: string, blockNumber: number, logIndex = 0): PositionTransfer => ({
  tokenId,
  from,
  to,
  blockNumber,
  logIndex,
});

describe("applyTransfers", () => {
  it("adds a token minted to the owner that the listing does not have yet", () => {
    expect(applyTransfers(["1", "2"], [transfer("3", ZERO, OWNER, 10)], OWNER)).toEqual(["1", "2", "3"]);
  });

  it("adds a token transferred in from another wallet", () => {
    expect(applyTransfers([], [transfer("3", OTHER, OWNER, 10)], OWNER)).toEqual(["3"]);
  });

  it("drops a listed token that was transferred away or burned", () => {
    const transfers = [transfer("1", OWNER, OTHER, 10), transfer("2", OWNER, ZERO, 11)];
    expect(applyTransfers(["1", "2", "3"], transfers, OWNER)).toEqual(["3"]);
  });

  it("deduplicates a token that is both listed and minted in the window", () => {
    expect(applyTransfers(["3", "1"], [transfer("3", ZERO, OWNER, 10)], OWNER)).toEqual(["3", "1"]);
  });

  it("follows the latest transfer of a token by block and log index, whatever the input order", () => {
    const outAndBack = [transfer("5", OTHER, OWNER, 12, 1), transfer("5", OWNER, OTHER, 12, 0), transfer("5", ZERO, OWNER, 9)];
    expect(applyTransfers([], outAndBack, OWNER)).toEqual(["5"]);
    const inAndOut = [transfer("6", OWNER, OTHER, 20), transfer("6", ZERO, OWNER, 19)];
    expect(applyTransfers(["6"], inAndOut, OWNER)).toEqual([]);
  });

  it("keeps a self-transfer and matches the owner case-insensitively", () => {
    expect(applyTransfers([], [transfer("7", OWNER, OWNER, 10)], OWNER.toUpperCase().replace("0X", "0x"))).toEqual(["7"]);
  });

  it("ignores transfers between other wallets", () => {
    expect(applyTransfers(["1"], [transfer("1", OTHER, ZERO, 10), transfer("2", ZERO, OTHER, 10)], OWNER)).toEqual(["1"]);
  });
});

describe("transferWindow", () => {
  it("ends at the head and spans the chain's window", () => {
    expect(transferWindow("polygon", 1_000n)).toEqual({ fromBlock: 701n, toBlock: 1_000n });
    expect(transferWindow("ethereum", 1_000n)).toEqual({ fromBlock: 951n, toBlock: 1_000n });
    expect(transferWindow("base", 5n)).toEqual({ fromBlock: 0n, toBlock: 5n });
  });
});
