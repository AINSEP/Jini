/** B133: two processes that both find no key file must not each write their own root key. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test, vi } from "vitest";
import { EnvOrFileKeyring, FixedRootKeyKeyring } from "../keyring.env.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
const exists = vi.mocked(fs.existsSync);
afterEach(() => exists.mockReset());

const hkdfSalt = "race-salt";
const input = { workspaceId: "ws-1", purpose: "vault", info: "row-key" };
const otherProcessKey = "ab".repeat(32);

function keyringFor(keyFilePath: string) {
  return new EnvOrFileKeyring({ env: { read: () => undefined }, envVarName: "RACE_ROOT_KEY", keyFilePath, hkdfSalt,
    allowFileFallback: true, allowFileAutoGenerate: true });
}

describe("EnvOrFileKeyring auto-generation race", () => {
  test("a key file created after the existence check is kept and used, never overwritten", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyring-race-"));
    const keyFilePath = path.join(dir, "root-key.hex");
    // The other process wins the race: its key lands between our existence check and our write.
    exists.mockImplementationOnce(() => {
      fs.writeFileSync(keyFilePath, otherProcessKey, { mode: 0o600 });
      return false;
    });

    const derived = await keyringFor(keyFilePath).derive(input);

    assert.equal(fs.readFileSync(keyFilePath, "utf8"), otherProcessKey);
    const expected = await new FixedRootKeyKeyring({ hex: otherProcessKey, hkdfSalt }).derive(input);
    assert.deepEqual(Buffer.from(derived), Buffer.from(expected));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a freshly generated key file is created owner-only and is what later instances read", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyring-race-"));
    const keyFilePath = path.join(dir, "root-key.hex");

    const first = await keyringFor(keyFilePath).derive(input);
    const second = await keyringFor(keyFilePath).derive(input);

    assert.equal(fs.statSync(keyFilePath).mode & 0o777, 0o600);
    assert.deepEqual(Buffer.from(second), Buffer.from(first));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
