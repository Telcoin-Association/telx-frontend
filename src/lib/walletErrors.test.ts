/** @jest-environment node */
import { BaseError, ContractFunctionExecutionError, UserRejectedRequestError, erc20Abi } from "viem";
import { isUserRejection } from "./walletErrors";

function withCode(message: string, code: number | string): Error {
  return Object.assign(new Error(message), { code });
}

describe("isUserRejection", () => {
  it("recognises viem's rejection error", () => {
    expect(isUserRejection(new UserRejectedRequestError(new Error("User rejected the request.")))).toBe(true);
  });

  it("finds a rejection wrapped by a contract write", () => {
    const error = new ContractFunctionExecutionError(new UserRejectedRequestError(new Error("denied")), {
      abi: erc20Abi,
      functionName: "approve",
      args: ["0x4444444444444444444444444444444444444444", 1n],
      contractAddress: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949",
    });

    expect(isUserRejection(error)).toBe(true);
  });

  it("finds a rejection wrapped by another viem error", () => {
    const wrapped = new BaseError("Transaction failed.", { cause: new UserRejectedRequestError(new Error("no")) });

    expect(isUserRejection(wrapped)).toBe(true);
  });

  it("accepts a bare EIP-1193 4001", () => {
    expect(isUserRejection({ code: 4001, message: "User denied transaction signature." })).toBe(true);
    expect(isUserRejection(withCode("User rejected", 4001))).toBe(true);
  });

  it("accepts ethers' ACTION_REJECTED code", () => {
    expect(isUserRejection(withCode("user rejected transaction", "ACTION_REJECTED"))).toBe(true);
  });

  it("finds a 4001 nested under a plain cause chain", () => {
    const error = new Error("outer", {
      cause: new Error("middle", { cause: { code: 4001, message: "User denied transaction signature." } }),
    });

    expect(isUserRejection(error)).toBe(true);
  });

  it("finds a 4001 under a viem error that wraps a plain error", () => {
    const error = new BaseError("Request failed.", { cause: withCode("wallet said no", 4001) });

    expect(isUserRejection(error)).toBe(true);
  });

  it("recognises a rejection from a nested viem copy by its class name", () => {
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["a viem error with no rejection", new BaseError("Execution reverted.")],
    ["an unauthorized provider error", withCode("Unauthorized", 4100)],
    ["an internal RPC error", withCode("Internal error", -32603)],
    ["a chain of unrelated errors", new Error("outer", { cause: new Error("inner", { cause: { code: 4900 } }) })],
  ])("rejects %s", (_label, error) => {
    expect(isUserRejection(error)).toBe(false);
  });

  it.each([null, undefined, "User rejected the request", 4001, true])("rejects the non-object %p", (value) => {
    expect(isUserRejection(value)).toBe(false);
  });

  it("stops on a cyclic cause chain", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    const b = { message: "b", cause: a };
    a.cause = b;

    expect(isUserRejection(a)).toBe(false);
  });

  it("still finds a rejection inside a cyclic cause chain", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    const b = { message: "b", code: 4001, cause: a };
    a.cause = b;

    expect(isUserRejection(a)).toBe(true);
  });

  it("stops walking causes after ten levels", () => {
    let error: unknown = { code: 4001 };
    for (let level = 0; level < 12; level += 1) {
      error = new Error(`level ${level}`, { cause: error });
    }

    expect(isUserRejection(error)).toBe(false);
  });
});
