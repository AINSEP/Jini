import { describe, expect, it, vi } from "vitest";
import { Argon2PasswordHasher } from "../hasher.js";

// F1 fix wave (Stryker L1 §4 hasher.ts:55,60 — default argon2 option object → {} survived; AP6).
// A fake binding records exactly what the adapter asks the native library to do.
function fakeBinding(verifyImpl: () => Promise<boolean> = async () => true) {
  const hash = vi.fn(async () => "$argon2id$fake");
  const verify = vi.fn(verifyImpl);
  return { binding: { argon2id: 2, hash, verify }, hash, verify };
}

describe("Argon2PasswordHasher — F1 pinned cost defaults", () => {
  it("defaults to argon2id with memoryCost 19456 KiB, timeCost 2, parallelism 1 (OWASP floor)", async () => {
    const { binding, hash } = fakeBinding();
    await new Argon2PasswordHasher({ loadBinding: () => binding }).hash({ password: "pw" });
    expect(hash).toHaveBeenCalledWith({ password: "pw" }, { type: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  });

  it("a partial override changes only the named parameter", async () => {
    const { binding, hash } = fakeBinding();
    await new Argon2PasswordHasher({ loadBinding: () => binding }, { timeCost: 3 }).hash({ password: "pw" });
    expect(hash).toHaveBeenCalledWith({ password: "pw" }, { type: 2, memoryCost: 19456, timeCost: 3, parallelism: 1 });
  });

  it("verify passes the stored hash and the candidate through, and resolves the binding's verdict", async () => {
    const { binding, verify } = fakeBinding(async () => false);
    expect(await new Argon2PasswordHasher({ loadBinding: () => binding }).verify({ hash: "$h", password: "pw" })).toBe(false);
    expect(verify).toHaveBeenCalledWith({ hash: "$h", password: "pw" });
  });

  it.each([["an Error", new Error("bad hash")], ["a string", "bad"]])("verify fails CLOSED (false) when the binding throws %s", async (_l, thrown) => {
    const { binding } = fakeBinding(async () => { throw thrown; });
    expect(await new Argon2PasswordHasher({ loadBinding: () => binding }).verify({ hash: "garbage", password: "pw" })).toBe(false);
  });
});
