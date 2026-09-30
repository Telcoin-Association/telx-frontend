/** @jest-environment node */
import { metadata } from "./page";

// The client page pulls in wagmi; metadata is all this test needs.
jest.mock("./EusdVaultPage", () => ({ __esModule: true, default: () => null }));

describe("eUSD Vault page metadata", () => {
  it("titles the page the way the other routes do", () => {
    expect(metadata.title).toBe("eUSD Vault - TELx Network");
    expect(metadata.openGraph?.title).toBe("TELx - eUSD Vault");
    expect(metadata.twitter?.title).toBe("TELx - eUSD Vault");
  });

  it("describes the swap in one sentence", () => {
    const description = "Swap USDC and eUSD at the peg-stability vault on Ethereum, Polygon and Base.";
    expect(metadata.description).toBe(description);
    expect(metadata.openGraph?.description).toBe(description);
    expect(metadata.twitter?.description).toBe(description);
  });
});
