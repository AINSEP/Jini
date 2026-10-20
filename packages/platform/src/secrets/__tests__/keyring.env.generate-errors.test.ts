/** Write-failure classification in generateFileRootKey, through a mocked fs write seam. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, test, vi } from "vitest";
import { RootKeyFileAlreadyExistsError, generateFileRootKey } from "../keyring.env.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn() };
});
const write = vi.mocked(fs.writeFileSync);
const keyFilePath = "/nonexistent-root/key.hex";

describe("generateFileRootKey write failures", () => {
  test("an ELOOP collision reports an existing key file", () => {
    write.mockImplementationOnce(() => { throw Object.assign(new Error("loop"), { code: "ELOOP" }); });
    assert.throws(() => generateFileRootKey({ keyFilePath }), (error: unknown) => error instanceof RootKeyFileAlreadyExistsError &&
      error.message === `a root key file already exists at ${keyFilePath} — generate never overwrites an existing key`);
  });

  test("an EEXIST collision reports an existing key file", () => {
    write.mockImplementationOnce(() => { throw Object.assign(new Error("exists"), { code: "EEXIST" }); });
    assert.throws(() => generateFileRootKey({ keyFilePath }), RootKeyFileAlreadyExistsError);
  });

  test("a thrown non-object is rethrown unchanged", () => {
    write.mockImplementationOnce(() => { throw "raw"; });
    assert.throws(() => generateFileRootKey({ keyFilePath }), (error: unknown) => error === "raw");
  });

  test("a thrown null is rethrown unchanged", () => {
    write.mockImplementationOnce(() => { throw null; });
    assert.throws(() => generateFileRootKey({ keyFilePath }), (error: unknown) => error === null);
  });

  test("an error without a code is rethrown unchanged", () => {
    const failure = new Error("no code");
    write.mockImplementationOnce(() => { throw failure; });
    assert.throws(() => generateFileRootKey({ keyFilePath }), (error: unknown) => error === failure);
  });

  test("writes exclusively at mode 0600", () => {
    write.mockImplementationOnce(() => undefined);
    const generated = generateFileRootKey({ keyFilePath });
    assert.deepEqual(write.mock.lastCall, [keyFilePath, generated.hex, { mode: 0o600, flag: "wx" }]);
  });
});
