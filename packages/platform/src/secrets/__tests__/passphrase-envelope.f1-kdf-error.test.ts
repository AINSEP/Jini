import { expect, it, vi } from "vitest";

// F1 fix wave (coverage: passphrase-envelope.ts:140 — the scrypt error callback). A KDF failure
// (e.g. the memory ceiling) must reject with that error, never resolve a keyring from no key.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: (_p: unknown, _s: unknown, _len: unknown, _opts: unknown, cb: (error: Error | null, key?: Buffer) => void) => cb(new RangeError("scrypt: memory limit exceeded")) };
});

it("a scrypt failure rejects sealing with the KDF error itself", async () => {
  const { sealWithPassphrase } = await import("../passphrase-envelope.js");
  await expect(sealWithPassphrase({ payload: "p", passphrase: "x" })).rejects.toThrow(new RangeError("scrypt: memory limit exceeded"));
});
