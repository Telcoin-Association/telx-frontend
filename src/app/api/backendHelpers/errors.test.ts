/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { HttpRequestError, TimeoutError } from "viem";
import { alchemyNftUrl, alchemyRpcUrl } from "./alchemy";
import { describeError, redactSecrets } from "./errors";

const KEY = "SECRETKEY123";

beforeAll(() => {
  process.env.ALCHEMY_ID = KEY;
});

describe("describeError", () => {
  it("keeps the Alchemy key out of a viem HttpRequestError built with a keyed URL", () => {
    const error = new HttpRequestError({ url: alchemyRpcUrl("polygon"), status: 500, body: { method: "eth_call" }, details: "boom" });
    // viem's own message carries the keyed URL, which is what this helper exists to avoid.
    expect(error.message).toContain(KEY);

    const described = describeError(error);
    expect(described).not.toContain(KEY);
    expect(described).toContain("HttpRequestError");
    expect(described).toContain(error.shortMessage);
  });

  it("keeps the key out of a viem TimeoutError", () => {
    const described = describeError(new TimeoutError({ body: {}, url: alchemyRpcUrl("base") }));
    expect(described).not.toContain(KEY);
    expect(described).toContain("TimeoutError");
  });

  it("redacts keyed URLs quoted in a plain Error message", () => {
    const error = new Error(`request to ${alchemyNftUrl("ethereum", "getNFTsForOwner")} failed`);
    const described = describeError(error);
    expect(described).not.toContain(KEY);
    expect(described).toBe("Error: request to https://eth-mainnet.g.alchemy.com/nft/v3/[redacted]/getNFTsForOwner failed");
  });

  it("describes non-Error values", () => {
    expect(describeError(`bad ${alchemyRpcUrl("polygon")}`)).toBe("bad https://polygon-mainnet.g.alchemy.com/v2/[redacted]");
    expect(describeError(undefined)).toBe("undefined");
  });
});

describe("redactSecrets", () => {
  it("removes an Alchemy key in a /v2/ path even when it is not the configured key", () => {
    expect(redactSecrets("URL: https://base-mainnet.g.alchemy.com/v2/otherKey?x=1")).toBe("URL: https://base-mainnet.g.alchemy.com/v2/[redacted]?x=1");
  });

  it("removes the configured key wherever it appears", () => {
    expect(redactSecrets(`key=${KEY}`)).toBe("key=[redacted]");
  });
});
