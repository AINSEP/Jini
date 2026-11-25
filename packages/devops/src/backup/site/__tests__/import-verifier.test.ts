import { describe, it, expect } from "vitest";
import { verifySiteImport, type SiteImportVerifierHost } from "../import-verifier.js";
import { ARCHIVE_DATABASE_PATH } from "../archive-manifest.js";
import { SAVED_KEYS_PATH } from "../saved-keys-port.js";

class Refused extends Error {}
/** A neutral in-memory host: the archive's listed files are given up front, every check is recorded. */
function host(files: Record<string, string>, overrides: Partial<SiteImportVerifierHost> = {}): SiteImportVerifierHost {
  return {
    redactSecretShapes: ({ text }) => ({ text: text.replace(/hostkey_\w+/g, "[REDACTED]"), redactions: /hostkey_/.test(text) ? 1 : 0 }),
    maxArchiveBytes: 10, archiveTooLargeMessage: "too big", checkShareLimits: () => undefined,
    refuseArchive: ({ message }) => { throw new Refused(message); },
    scanArchiveMetadata: async () => ({ manifestBytes: "m", fileAliases: "a", directories: "d", wrapper: "w" }),
    parseShareManifest: () => ({ files: [], plugins: [], site: { name: "  Site A  " } }),
    buildManifestInventory: () => "inventory", checkArchiveMatchesInventory: () => undefined,
    readListedFiles: async () => new Map(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)])),
    sha256Hex: () => "hash", applyShareProjection: async () => undefined, readBundledPackageFiles: async () => new Map(),
    archiveToRuntimePath: ({ path }) => `runtime/${path}`, editedArchiveWarnings: ({ units }) => [...units].map(unit => `edited ${unit}`),
    ...overrides,
  };
}
const reader = {} as never, schema = { index: 1, tag: "one" };

describe("import verifier host injection", () => {
  it("refuses an archive over the injected cap with the injected message before reading it", async () => {
    let scanned = false;
    const h = host({}, { scanArchiveMetadata: async () => { scanned = true; throw new Error("unreachable"); } });
    await expect(verifySiteImport({ archive: Buffer.alloc(11), reader, sanitize: async () => ({ bytes: Buffer.alloc(0) }), schema, host: h })).rejects.toThrow("too big");
    expect(scanned).toBe(false);
  });
  it("splits off saved keys and the database, maps runtime paths and redacts projection warnings", async () => {
    const h = host({ [ARCHIVE_DATABASE_PATH]: "db", [SAVED_KEYS_PATH]: "keys", "media/a.png": "png" });
    const result = await verifySiteImport({ archive: Buffer.from("zip"), reader, schema, host: h,
      sanitize: async () => ({ bytes: Buffer.from("clean-db"), notices: ["note"], credentialWarnings: [{ path: "hostkey_secret.txt", kind: "credential filename" }] }) });
    expect(result.name).toBe("Site A");
    expect(result.encryptedKeys?.toString()).toBe("keys");
    expect(result.database.toString()).toBe("clean-db");
    expect([...result.files.keys()]).toEqual(["runtime/media/a.png"]);
    expect(result.warnings).toEqual(["note"]);
    expect(JSON.stringify(result.credentialWarnings)).not.toContain("hostkey_secret");
  });
  it("refuses an archive without a content database through the injected refusal", async () => {
    await expect(verifySiteImport({ archive: Buffer.from("zip"), reader, schema, host: host({ "media/a.png": "png" }), sanitize: async () => ({ bytes: Buffer.alloc(0) }) })).rejects.toBeInstanceOf(Refused);
  });
});
