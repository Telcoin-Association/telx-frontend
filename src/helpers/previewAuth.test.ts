import { isPreviewAuthorized } from "./previewAuth";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

describe("isPreviewAuthorized", () => {
  const expected = "stakeholder:s3cret";

  it("rejects a missing header", () => {
    expect(isPreviewAuthorized(null, expected)).toBe(false);
  });

  it("rejects a non-Basic scheme", () => {
    expect(isPreviewAuthorized("Bearer abc", expected)).toBe(false);
  });

  it("rejects wrong credentials", () => {
    expect(isPreviewAuthorized(basic("stakeholder:wrong"), expected)).toBe(false);
  });

  it("accepts the correct credentials", () => {
    expect(isPreviewAuthorized(basic(expected), expected)).toBe(true);
  });

  it("accepts a password containing a colon", () => {
    const withColon = "user:pa:ss";
    expect(isPreviewAuthorized(basic(withColon), withColon)).toBe(true);
  });

  it("returns false on malformed base64 instead of throwing", () => {
    expect(() => isPreviewAuthorized("Basic %%%", expected)).not.toThrow();
    expect(isPreviewAuthorized("Basic %%%", expected)).toBe(false);
  });
});
