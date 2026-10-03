import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvOrFileKeyring, FixedRootKeyKeyring, inspectRootKeyMaterial, revealRootKeyMaterial, type EnvOrFileKeyringRequired } from "../keyring.env.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(): EnvOrFileKeyringRequired {
  const dir = mkdtempSync(join(tmpdir(), "keyring-defaults-"));
  dirs.push(dir);
  return { envVarName: "APP_ROOT_KEY", keyFilePath: join(dir, "key.hex"), hkdfSalt: "test-salt",
    env: { read: () => undefined }, allowFileFallback: false, allowFileAutoGenerate: false };
}
const input = { workspaceId: "ws", purpose: "sealer", info: "v1" };
describe("keyring security defaults", () => {
  it.each(["env", "allowFileFallback", "allowFileAutoGenerate"] as const)("requires explicit %s without creating a file", omitted => {
    const required = fixture();
    const keyFilePath = required.keyFilePath;
    Reflect.deleteProperty(required, omitted);
    expect(() => new EnvOrFileKeyring(required)).toThrow(TypeError);
    expect(existsSync(keyFilePath)).toBe(false);
  });
  it.each([undefined, null, "true", 1])("rejects non-boolean fallback flags %s", flag => {
    for (const name of ["allowFileFallback", "allowFileAutoGenerate"] as const) {
      const required = fixture();
      expect(() => new EnvOrFileKeyring({ ...required, [name]: flag } as unknown as EnvOrFileKeyringRequired)).toThrow(TypeError);
      expect(existsSync(required.keyFilePath)).toBe(false);
    }
  });
  it("refuses an existing file when fallback is disabled, even if generation is enabled", async () => {
    const required = fixture();
    writeFileSync(required.keyFilePath, "bb".repeat(32));
    await expect(new EnvOrFileKeyring({ ...required, allowFileAutoGenerate: true }).derive(input)).rejects.toThrow("allowFileFallback is disabled");
    expect(readFileSync(required.keyFilePath, "utf8")).toBe("bb".repeat(32));
  });
  it("explicit fallback permits reads but no creation unless generation is also explicit", async () => {
    const required = { ...fixture(), allowFileFallback: true };
    await expect(new EnvOrFileKeyring(required).derive(input)).rejects.toThrow("does not auto-generate");
    expect(existsSync(required.keyFilePath)).toBe(false);
    writeFileSync(required.keyFilePath, "bb".repeat(32));
    expect(await new EnvOrFileKeyring(required).derive(input)).toEqual(await new FixedRootKeyKeyring({ hex: "bb".repeat(32), hkdfSalt: required.hkdfSalt }).derive(input));
  });
  it("uses only injected env material, caches it and preserves derivation bytes", async () => {
    const required = fixture();
    let hex = "aa".repeat(32);
    const keyring = new EnvOrFileKeyring({ ...required, env: { read: ({ name }) => name === required.envVarName ? hex : undefined } });
    const secret = await keyring.derive(input);
    expect(secret).toEqual(await new FixedRootKeyKeyring({ hex, hkdfSalt: required.hkdfSalt }).derive(input));
    hex = "bb".repeat(32);
    expect(await keyring.derive(input)).toEqual(secret);
    expect(existsSync(required.keyFilePath)).toBe(false);
  });
  it("creates a file only with both explicit permissions", async () => {
    const required = { ...fixture(), allowFileFallback: true, allowFileAutoGenerate: true };
    const first = await new EnvOrFileKeyring(required).derive(input);
    expect(readFileSync(required.keyFilePath, "utf8")).toMatch(/^[a-f0-9]{64}$/);
    expect(await new EnvOrFileKeyring(required).derive(input)).toEqual(first);
  });
});

it("inspection and reveal share the injected env source without generating a key file", () => {
  const required = fixture();
  const hex = "cc".repeat(32);
  const options = { envVarName: required.envVarName, keyFilePath: required.keyFilePath,
    env: { read: ({ name }: { name: string }) => name === required.envVarName ? hex : undefined } };
  const status = inspectRootKeyMaterial(options);
  expect(status).toMatchObject({ active: true, source: "env" });
  expect(status).not.toHaveProperty("hex");
  expect(revealRootKeyMaterial(options)).toEqual({ ...status, hex });
  expect(existsSync(required.keyFilePath)).toBe(false);
});
