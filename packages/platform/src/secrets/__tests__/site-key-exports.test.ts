import { describe, expect, it } from "vitest";
import * as secrets from "../index.js";
import type { SiteKeyHandle, SiteKeyStatus, SiteKeyEnvironmentPort } from "../index.js";

describe("canonical site key exports", () => {
  it("exports each canonical value as the same implementation as its deprecated alias", () => {
    const names = ["Fixed", "Unusable", "", "parse", "fingerprint", "inspect", "reveal", "generateFile", "deriveFrom", "deriveSigningSecretFrom"];
    const suffixes = ["Keyring", "Error", "FileAlreadyExistsError", "Hex", "Hex", "Material", "Material", "", "", ""];
    for (const [index, prefix] of names.entries()) {
      const canonical = prefix + "SiteKey" + suffixes[index];
      const legacy = prefix + "Root" + "Key" + suffixes[index];
      expect((secrets as Record<string, unknown>)[canonical], canonical).toBeTypeOf("function");
      expect((secrets as Record<string, unknown>)[canonical]).toBe((secrets as Record<string, unknown>)[legacy]);
    }
    expect(secrets.parseSiteKeyHex({ raw: "aa".repeat(32) })).toMatchObject({ ok: true });
    expect(secrets.fingerprintSiteKeyHex({ hex: "aa".repeat(32) })).toBe("e0e77a507412");
  });

  it("exposes canonical port and status types through the public entry", () => {
    const handle: SiteKeyHandle = { keyId: "v1" };
    const env: SiteKeyEnvironmentPort = { read: () => "aa".repeat(32) };
    const status: SiteKeyStatus = secrets.inspectSiteKeyMaterial({ env, envVarName: "KEY", keyFilePath: "/unused" });
    expect(handle.keyId).toBe("v1");
    expect(status.active).toBe(true);
  });
});
