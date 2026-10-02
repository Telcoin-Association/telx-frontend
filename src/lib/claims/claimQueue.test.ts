import { ClaimInProgressError, isClaimRunning, runExclusive } from "./claimQueue";

describe("runExclusive", () => {
  it("runs one claim at a time and refuses a second while the first is running", async () => {
    let release: () => void = () => {};
    const first = runExclusive(() => new Promise<string>((resolve) => (release = () => resolve("first"))));
    expect(isClaimRunning()).toBe(true);

    const second = jest.fn(async () => "second");
    await expect(runExclusive(second)).rejects.toBeInstanceOf(ClaimInProgressError);
    expect(second).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toBe("first");
    expect(isClaimRunning()).toBe(false);
    await expect(runExclusive(second)).resolves.toBe("second");
  });

  it("frees the queue when a claim throws", async () => {
    await expect(runExclusive(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(isClaimRunning()).toBe(false);
  });
});
