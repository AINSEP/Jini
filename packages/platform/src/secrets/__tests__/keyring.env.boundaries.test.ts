/** Boundary pins for EnvOrFileKeyring construction, FixedRootKeyKeyring parsing and key-file generation. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test, vi } from "vitest";
import { defaultPlatformMessages, type PlatformMessages } from "../../messages.js";
import { EnvOrFileKeyring, FixedRootKeyKeyring, UnusableRootKeyError, deriveFromRootKey, deriveSigningSecretFromRootKey, generateFileRootKey, type EnvOrFileKeyringRequired } from "../keyring.env.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function required(patch: Partial<EnvOrFileKeyringRequired> = {}): EnvOrFileKeyringRequired {
  const dir = mkdtempSync(join(tmpdir(), "keyring-pins-"));
  dirs.push(dir);
  return { envVarName: "APP_ROOT_KEY", keyFilePath: join(dir, "key.hex"), hkdfSalt: "salt",
    env: { read: () => undefined }, allowFileFallback: false, allowFileAutoGenerate: false, ...patch };
}
const typeError = (message: string) => ({ name: "TypeError", message });

describe("EnvOrFileKeyring construction", () => {
  for (const name of ["envVarName", "keyFilePath", "hkdfSalt"] as const) {
    for (const value of [undefined, null]) {
      test(`refuses ${String(value)} ${name}`, () => {
        assert.throws(() => new EnvOrFileKeyring({ ...required(), [name]: value } as unknown as EnvOrFileKeyringRequired), typeError(`${name} is required`));
      });
    }
  }

  test("accepts an empty-string salt as supplied", async () => {
    const keyring = new EnvOrFileKeyring(required({ hkdfSalt: "" }));
    assert.deepEqual(await keyring.activeKey({}), { keyId: "v1" });
  });

  test("refuses a missing required object with the first option's name", () => {
    assert.throws(() => new EnvOrFileKeyring(undefined as unknown as EnvOrFileKeyringRequired), typeError("envVarName is required"));
  });

  test("checks names in order: envVarName before keyFilePath", () => {
    assert.throws(() => new EnvOrFileKeyring({ ...required(), envVarName: undefined, keyFilePath: undefined } as unknown as EnvOrFileKeyringRequired),
      typeError("envVarName is required"));
  });

  test("refuses an env port without a read function", () => {
    assert.throws(() => new EnvOrFileKeyring({ ...required(), env: {} } as unknown as EnvOrFileKeyringRequired), typeError("env.read is required"));
  });

  test("refuses a missing env port", () => {
    assert.throws(() => new EnvOrFileKeyring({ ...required(), env: undefined } as unknown as EnvOrFileKeyringRequired), typeError("env.read is required"));
  });

  test("refuses a non-boolean file fallback flag", () => {
    assert.throws(() => new EnvOrFileKeyring({ ...required(), allowFileFallback: "yes" } as unknown as EnvOrFileKeyringRequired),
      typeError("allowFileFallback must be an explicit boolean"));
  });

  test("refuses a non-boolean auto-generate flag", () => {
    assert.throws(() => new EnvOrFileKeyring({ ...required(), allowFileAutoGenerate: 0 } as unknown as EnvOrFileKeyringRequired),
      typeError("allowFileAutoGenerate must be an explicit boolean"));
  });

  test("never reads the environment at construction", () => {
    const read = vi.fn(() => undefined);
    new EnvOrFileKeyring(required({ env: { read } }));
    assert.equal(read.mock.calls.length, 0);
  });

  test("uses injected messages for the sealed-material warning", async () => {
    const messages: PlatformMessages = { ...defaultPlatformMessages, rootKeySealedWarning: ({ subject }) => `WARN(${subject}) ` };
    const keyring = new EnvOrFileKeyring(required({ env: { read: () => "ab" } }), { messages });
    await assert.rejects(keyring.derive({ workspaceId: "ws", purpose: "p", info: "i" }),
      (error: unknown) => error instanceof UnusableRootKeyError && error.message.includes("WARN(this value) "));
  });

  test("defaults to the platform sealed-material warning", async () => {
    const keyring = new EnvOrFileKeyring(required({ env: { read: () => "ab" } }));
    await assert.rejects(keyring.derive({ workspaceId: "ws", purpose: "p", info: "i" }),
      (error: unknown) => error instanceof UnusableRootKeyError && error.message.includes(defaultPlatformMessages.rootKeySealedWarning({ subject: "this value" })));
  });
});

describe("FixedRootKeyKeyring", () => {
  test("refuses short hex with the rejection reason", () => {
    assert.throws(() => new FixedRootKeyKeyring({ hex: "ab", hkdfSalt: "s" }), { name: "Error", message: "FixedRootKeyKeyring: not a valid root key (too-short)" });
  });

  const hex = "11".repeat(32);
  test("reports the default key generation", async () => {
    assert.deepEqual(await new FixedRootKeyKeyring({ hex, hkdfSalt: "s" }).activeKey({}), { keyId: "v1" });
  });

  test("reports a configured key generation", async () => {
    assert.deepEqual(await new FixedRootKeyKeyring({ hex, hkdfSalt: "s" }, { keyId: "v7" }).activeKey({}), { keyId: "v7" });
  });

  test("derives signing secrets from the parsed root and salt", async () => {
    const input = { workspaceId: "ws", subscriptionId: "sub", version: 2 };
    assert.deepEqual(await new FixedRootKeyKeyring({ hex, hkdfSalt: "s" }).deriveSigningSecret(input),
      deriveSigningSecretFromRootKey({ rootKey: Buffer.from(hex, "hex"), input, hkdfSalt: "s" }));
  });

  test("derives purpose keys from the parsed root and salt", async () => {
    const input = { workspaceId: "ws", purpose: "p", info: "i" };
    assert.deepEqual(await new FixedRootKeyKeyring({ hex, hkdfSalt: "s" }).derive(input),
      deriveFromRootKey({ rootKey: Buffer.from(hex, "hex"), input, hkdfSalt: "s" }));
  });

  test("refuses a missing salt before parsing", () => {
    assert.throws(() => new FixedRootKeyKeyring({ hex: "zz", hkdfSalt: undefined } as unknown as { hex: string; hkdfSalt: string }), typeError("hkdfSalt is required"));
  });
});

describe("generateFileRootKey", () => {
  test("rethrows a write failure that is not an existing-path collision", () => {
    const dir = mkdtempSync(join(tmpdir(), "keyring-gen-"));
    dirs.push(dir);
    assert.throws(() => generateFileRootKey({ keyFilePath: join(dir, "k".repeat(300)) }), { code: "ENAMETOOLONG" });
  });
});
