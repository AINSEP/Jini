import { describe, expect, it } from "vitest";
import { createArchiveManifestCodec, requireArchiveFileRecord, type ArchiveManifestDeps } from "../archive-manifest.js";
import { SiteShareRefusal } from "../share-refusal.js";

const hash = "b".repeat(64);
const schema = { index: 2, tag: "two" };
const scopes = { database: true, media: true, themes: true, plugins: true, settings: true };
const base = { schema, site: { name: "Portable" }, scopes, media: [], plugins: [], files: ["content.db", "settings.json"].map(path => ({ path, bytes: 1, sha256: hash })) };
const claimed: string[] = [];
const deps: ArchiveManifestDeps = {
  limits: { maxManifestBytes: 4000, maxFiles: 5 },
  versionMismatchMessage: "host advice: export again",
  claimSharePath: ({ path, aliases, files }) => {
    claimed.push(path);
    const alias = path.toLowerCase();
    if (aliases.has(alias) || files.has(path)) throw new SiteShareRefusal({ code: "UNSAFE_PATH", message: "clash" });
    aliases.set(alias, path); files.add(path);
  },
  isBundledSchemaIdentity: ({ schema: identity }) => identity.index === 1,
};
const codec = createArchiveManifestCodec(deps);
const parse = (value: unknown, expected = schema) => codec.parseArchiveManifest({ bytes: Buffer.from(JSON.stringify(value)), schema: expected });
const valid = { formatVersion: 2, profile: "share", ...base };
const invalid = { code: "INVALID_ARCHIVE" };
const mediaFiles = (count: number) => {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, slug: `s${i}`, path: `media/m${i}.bin`, sha256: hash }));
  return { files: [...base.files, ...rows.map(row => ({ path: row.path, bytes: 1, sha256: hash }))], media: rows };
};

describe("archive manifest codec", () => {
  it("serializes two-space JSON with a trailing newline and round-trips (mutation compact-json)", () => {
    const text = codec.buildArchiveManifest(base);
    expect(text).toBe(JSON.stringify({ formatVersion: 2, profile: "share", ...base }, null, 2) + "\n");
    expect(codec.parseArchiveManifest({ bytes: Buffer.from(text), schema })).toEqual(valid);
  });

  it("claims every path through the host, so aliases cannot share a file (mutation skip-claim)", () => {
    claimed.length = 0;
    parse(valid);
    expect(claimed).toEqual(["manifest.json", "content.db", "settings.json"]);
    expect(() => parse({ ...valid, files: [...base.files, { path: "media/A.bin", bytes: 1, sha256: hash }, { path: "media/a.bin", bytes: 1, sha256: hash }] })).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  });

  it("refuses a manifest over the host's byte cap before parsing it (mutation ignore-manifest-cap)", () => {
    const padded = Buffer.from(JSON.stringify(valid) + " ".repeat(4000));
    expect(() => codec.parseArchiveManifest({ bytes: padded, schema })).toThrow(expect.objectContaining(invalid));
  });

  it("counts the manifest toward the host's file cap (mutation ignore-file-cap)", () => {
    expect(() => parse({ ...valid, ...mediaFiles(2) })).not.toThrow();
    expect(() => parse({ ...valid, ...mediaFiles(3) })).toThrow(expect.objectContaining(invalid));
  });

  it("gives host advice for a known other schema and names an invented one (mutation always-bundled)", () => {
    const known = { index: 1, tag: "one" };
    expect(() => parse({ ...valid, schema: known })).toThrow(expect.objectContaining({ ...invalid, message: "host advice: export again" }));
    expect(() => parse({ ...valid, schema: { index: 9, tag: "nine" } })).toThrow(expect.objectContaining({ ...invalid, message: 'Unknown archive schema identity {"index":9,"tag":"nine"}.' }));
  });

  it("refuses malformed identity, scopes, media and plugin coverage", () => {
    for (const extra of [{ formatVersion: 1 }, { profile: "repo" }, { scopes: { ...scopes, media: false } }, { site: { name: " " } }, { files: [base.files[0]] }, { media: [{ id: "m", slug: "s", path: "media/x.bin", sha256: hash }] }]) {
      expect(() => parse({ ...valid, ...extra })).toThrow(expect.objectContaining(invalid));
    }
    const files = [...base.files, { path: "plugins/demo/package/plugin.json", bytes: 1, sha256: hash }];
    expect(() => parse({ ...valid, files, plugins: [] })).toThrow(expect.objectContaining(invalid));
    const plugin = { kind: "site", id: "demo", version: "1.0.0", digest: hash, enabled: true, shipped: true };
    expect(() => parse({ ...valid, files, plugins: [plugin] })).not.toThrow();
  });

  it("requireArchiveFileRecord accepts a path/size/hash record and refuses anything else", () => {
    expect(requireArchiveFileRecord({ file: base.files[0] })).toEqual(base.files[0]);
    for (const file of [null, "x", { path: "a" }, { path: "a", bytes: -1, sha256: hash }, { path: "a", bytes: 1, sha256: "bad" }]) {
      expect(() => requireArchiveFileRecord({ file })).toThrow(expect.objectContaining(invalid));
    }
  });
});

const savedKeys = { version: 1, path: "secrets/saved-keys.json", format: "jini-passphrase-envelope" };
const encrypted = { ...valid, encryptedKeys: savedKeys, files: [...base.files, { path: savedKeys.path, bytes: 23, sha256: hash }] };

it("round-trips the versioned encrypted attachment when it is in the inventory", () => {
  expect(parse(encrypted)).toEqual(encrypted);
});

it.each([
  ["version", { ...encrypted, encryptedKeys: { ...savedKeys, version: 2 } }],
  ["path", { ...encrypted, encryptedKeys: { ...savedKeys, path: "secrets/other.json" } }],
  ["format", { ...encrypted, encryptedKeys: { ...savedKeys, format: "plaintext" } }],
  ["missing inventory record", { ...encrypted, files: base.files }],
  ["missing descriptor", { ...encrypted, encryptedKeys: undefined }],
])("rejects an inconsistent encrypted attachment (%s)", (_reason, manifest) => {
  expect(() => parse(manifest)).toThrow(expect.objectContaining({
    code: "INVALID_ARCHIVE", message: "Invalid v2 share manifest, inventory or schema identity.",
  }));
});
