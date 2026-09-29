/**
 * @jest-environment node
 */
import { checkPreviewAuth, constantTimeEqual, isPreviewAuthorized, previewAuthChallenge, previewAuthToken } from "./previewAuth";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

describe("isPreviewAuthorized", () => {
  const expected = "reviewer:s3cret";

  it("rejects a missing header", async () => {
    await expect(isPreviewAuthorized(null, expected)).resolves.toBe(false);
  });

  it("rejects a non-Basic scheme", async () => {
    await expect(isPreviewAuthorized("Bearer abc", expected)).resolves.toBe(false);
  });

  it("rejects wrong credentials", async () => {
    await expect(isPreviewAuthorized(basic("reviewer:wrong"), expected)).resolves.toBe(false);
  });

  it("rejects credentials that are a prefix of the secret", async () => {
    await expect(isPreviewAuthorized(basic("reviewer:s3cre"), expected)).resolves.toBe(false);
  });

  it("accepts the correct credentials", async () => {
    await expect(isPreviewAuthorized(basic(expected), expected)).resolves.toBe(true);
  });

  it("accepts a password containing a colon", async () => {
    const withColon = "user:pa:ss";
    await expect(isPreviewAuthorized(basic(withColon), withColon)).resolves.toBe(true);
  });

  it("resolves false on malformed base64 instead of throwing", async () => {
    await expect(isPreviewAuthorized("Basic %%%", expected)).resolves.toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("previewAuthToken", () => {
  it("is the hex SHA-256 of the secret", async () => {
    await expect(previewAuthToken("a:b")).resolves.toBe("6783a31eabf68ccc0660f935c0826282bdd2241f3a80a9f2d10d59aea9ebb5d8");
  });

  it("changes when the secret changes", async () => {
    expect(await previewAuthToken("a:b")).not.toBe(await previewAuthToken("a:c"));
  });

  it("hashes a secret once and reuses the digest", () => {
    const digest = jest.spyOn(crypto.subtle, "digest");
    const first = previewAuthToken("memo:secret");
    const second = previewAuthToken("memo:secret");
    expect(second).toBe(first);
    expect(digest).toHaveBeenCalledTimes(1);
    digest.mockRestore();
  });
});

describe("checkPreviewAuth", () => {
  const expected = "reviewer:s3cret";

  it("accepts the remember-me cookie without issuing a new one", async () => {
    const cookie = await previewAuthToken(expected);
    await expect(checkPreviewAuth(cookie, null, expected)).resolves.toEqual({ authorized: true, issueCookie: null });
  });

  it("accepts Basic credentials and issues the remember-me cookie", async () => {
    const token = await previewAuthToken(expected);
    await expect(checkPreviewAuth(undefined, basic(expected), expected)).resolves.toEqual({ authorized: true, issueCookie: token });
  });

  it("falls back to Basic credentials when the cookie is stale", async () => {
    const stale = await previewAuthToken("reviewer:old");
    const result = await checkPreviewAuth(stale, basic(expected), expected);
    expect(result).toEqual({ authorized: true, issueCookie: await previewAuthToken(expected) });
  });

  it("rejects a request with neither", async () => {
    await expect(checkPreviewAuth("not-the-token", basic("reviewer:wrong"), expected)).resolves.toEqual({ authorized: false });
  });
});

describe("previewAuthChallenge", () => {
  it("is a 401 with a Basic challenge", () => {
    const res = previewAuthChallenge();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm=/);
  });
});
