/**
 * @jest-environment node
 */
import {
  PREVIEW_AUTH_COOKIE,
  apiPreviewRejection,
  checkPreviewAuth,
  constantTimeEqual,
  isPreviewAuthorized,
  previewAuthChallenge,
  previewAuthToken,
} from "./previewAuth";

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

describe("apiPreviewRejection", () => {
  const secret = "reviewer:s3cret";
  const request = (headers: Record<string, string> = {}) => new Request("https://preview.telx.network/api/pools", { headers });

  afterEach(() => {
    delete process.env.PREVIEW_BASIC_AUTH;
  });

  it("lets every request through when PREVIEW_BASIC_AUTH is unset", async () => {
    await expect(apiPreviewRejection(request())).resolves.toBeNull();
  });

  describe("when PREVIEW_BASIC_AUTH is set", () => {
    beforeEach(() => {
      process.env.PREVIEW_BASIC_AUTH = secret;
    });

    it("lets through a request carrying the remember-me cookie among other cookies", async () => {
      const token = await previewAuthToken(secret);
      await expect(apiPreviewRejection(request({ cookie: `theme=dark; ${PREVIEW_AUTH_COOKIE}=${token}; other=1` }))).resolves.toBeNull();
    });

    it("lets through a request when any of several same-named cookies holds the token", async () => {
      const token = await previewAuthToken(secret);
      await expect(apiPreviewRejection(request({ cookie: `${PREVIEW_AUTH_COOKIE}=stale; ${PREVIEW_AUTH_COOKIE}=${token}` }))).resolves.toBeNull();
    });

    it("lets through a request carrying valid Basic credentials", async () => {
      await expect(apiPreviewRejection(request({ authorization: basic(secret) }))).resolves.toBeNull();
    });

    it("answers a JSON 401 with no login dialog when the login is missing or wrong", async () => {
      const attempts: Record<string, string>[] = [{}, { cookie: `${PREVIEW_AUTH_COOKIE}=stale` }, { authorization: basic("reviewer:wrong") }];
      for (const headers of attempts) {
        const res = await apiPreviewRejection(request(headers));
        expect(res?.status).toBe(401);
        expect(res?.headers.get("www-authenticate")).toBeNull();
        expect(res?.headers.get("cache-control")).toBe("no-store");
        await expect(res?.json()).resolves.toEqual({ error: "Preview login required" });
      }
    });
  });
});
