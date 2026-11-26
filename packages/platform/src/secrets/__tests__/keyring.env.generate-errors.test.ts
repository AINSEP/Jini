/** Write-failure classification in generateFileRootKey, through a mocked fs write seam. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, test, vi } from "vitest";
import { EnvOrFileKeyring, RootKeyFileAlreadyExistsError, generateFileRootKey } from "../keyring.env.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync) };
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

test("auto-generation never replaces a root key created concurrently", async () => {
  const winner = "ab".repeat(32);
  const required = { env: { read: () => undefined }, envVarName: "ROOT_KEY", keyFilePath,
    hkdfSalt: "root-key-race", allowFileFallback: true, allowFileAutoGenerate: true };
  const keyring = new EnvOrFileKeyring(required);
  const input = { workspaceId: "workspace", purpose: "test", info: "race" };
  vi.mocked(fs.existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.mocked(fs.readFileSync).mockReturnValueOnce(winner);
  write.mockImplementationOnce((_path, _data, options) => {
    assert.deepEqual(options, { mode: 0o600, flag: "wx" });
    throw Object.assign(new Error("exists"), { code: "EEXIST" });
  });
  await assert.rejects(keyring.derive(input), RootKeyFileAlreadyExistsError);
  const expected = new EnvOrFileKeyring({ ...required, env: { read: () => winner } });
  assert.deepEqual(await keyring.derive(input), await expected.derive(input));
});
