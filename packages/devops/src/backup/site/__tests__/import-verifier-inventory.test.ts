import { describe, it, expect, vi } from "vitest";
import { SiteShareRefusal } from "../share-refusal.js";
import { buildManifestInventory, checkArchiveMatchesInventory, parseShareManifest, readListedFiles, refuseArchive, scanArchiveMetadata, sha256Hex, ignoredArchivePath, type ImportInventoryHost } from "../import-verifier-inventory.js";

type Entry = { kind: "file" | "directory" | "symlink"; entryPath: string; declaredSize?: number; body?: Buffer };

function reader(entries: readonly Entry[]) {
  return { entries: async function* () { for (const e of entries) yield { kind: e.kind, entryPath: e.entryPath, declaredSize: e.declaredSize ?? e.body?.length, openReadStream: async function* () { if (e.body) yield new Uint8Array(e.body); } }; } } as never;
}

function host(over: Partial<ImportInventoryHost> = {}): ImportInventoryHost {
  const refuse = (message: string) => { throw new SiteShareRefusal({ code: "UNSAFE_PATH", message }); };
  return {
    limits: { maxFiles: 5, maxManifestBytes: 64, maxExpandedBytes: 100 },
    inventoryRoots: /^(?:media|themes|plugins)\/.+/,
    settingsFiles: ["settings.json"],
    changedArchiveMessage: "Changed since export.",
    checkShareLimits: () => {},
    validateSharePath: ({ path }) => { if (path.includes("..")) refuse("bad path"); },
    excludedSharePath: ({ path }) => path.startsWith("private/"),
    requireShareSecretFree: () => true,
    claimSharePath: ({ path, aliases, files }) => { const key = path.toLowerCase(); if (aliases.has(key)) refuse("collision"); aliases.set(key, path); files.add(key); },
    parseArchiveManifest: ({ bytes }) => JSON.parse(bytes.toString()),
    archiveCodeUnit: ({ path }) => /^plugins\/[^/]+\//.exec(path)?.[0].slice(0, -1),
    archiveSecretScanPath: ({ path }) => `scan/${path}`,
    ...over,
  };
}

const manifest = Buffer.from("{}");
const file = (entryPath: string, text = "x"): Entry => ({ kind: "file", entryPath, body: Buffer.from(text) });

describe("scanArchiveMetadata", () => {
  it("returns the manifest and no wrapper for a root manifest", async () => {
    const scan = await scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("manifest.json", "{}"), file("media/a.png")]), host: host() });
    expect(scan.wrapper).toBe("");
    expect(scan.manifestBytes.toString()).toBe("{}");
    expect([...scan.fileAliases].sort()).toEqual(["manifest.json", "media/a.png"]);
  });
  it("detects one wrapper folder holding every entry (mutation: wrapper-always-empty)", async () => {
    const scan = await scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([{ kind: "directory", entryPath: "bundle/" }, file("bundle/manifest.json", "{}"), file("bundle/media/a.png")]), host: host() });
    expect(scan.wrapper).toBe("bundle/");
    expect([...scan.fileAliases]).toContain("media/a.png");
  });
  it("refuses a second top-level folder as no wrapper, so the root manifest is required", async () => {
    await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("a/manifest.json", "{}"), file("b/x")]), host: host() })).rejects.toThrow(/manifest\.json at root/);
  });
  it("enforces the injected entry cap (mutation: drop-entry-cap)", async () => {
    const many = Array.from({ length: 6 }, (_, i) => file(`media/${i}.png`));
    await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("manifest.json", "{}"), ...many]), host: host() })).rejects.toThrow(/entry cap/);
  });
  it("bounds the manifest read by the injected size (mutation: drop-manifest-bound)", async () => {
    const big = file("manifest.json", "x".repeat(65));
    await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([big]), host: host() })).rejects.toThrow(/ZIP bomb/);
  });
  it("refuses links and special entries", async () => {
    await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("manifest.json", "{}"), { kind: "symlink", entryPath: "media/l" }]), host: host() })).rejects.toThrow(/links and special/);
  });
  it("claims every path through the host policy (mutation: skip-claim)", async () => {
    const claim = vi.fn(host().claimSharePath);
    await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("manifest.json", "{}"), file("media/A.png"), file("media/a.png")]), host: host({ claimSharePath: claim }) })).rejects.toThrow(/collision/);
    expect(claim).toHaveBeenCalled();
  });
  it("refuses a declared size that is not a safe integer and passes sizes to the injected limit check", async () => {
    const check = vi.fn();
    await scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("manifest.json", "{}"), file("media/a.png", "abc")]), host: host({ checkShareLimits: check }) });
    expect(check).toHaveBeenLastCalledWith({ files: [{ path: "manifest.json", bytes: 2 }, { path: "media/a.png", bytes: 3 }] });
    await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([file("manifest.json", "{}"), { kind: "file", entryPath: "media/b", body: Buffer.alloc(0), declaredSize: -1 }]), host: host() })).rejects.toThrow(/invalid declared size/);
  });
  it("ignores Finder metadata in both passes", () => {
    expect(ignoredArchivePath({ path: "__MACOSX/x" })).toBe(true);
    expect(ignoredArchivePath({ path: "media/.DS_Store" })).toBe(true);
    expect(ignoredArchivePath({ path: "media/a.png" })).toBe(false);
  });
});

describe("manifest inventory", () => {
  const record = (path: string) => ({ path, bytes: 1, sha256: "a".repeat(64) });
  it("keys valid records, the database and settings files", () => {
    const inv = buildManifestInventory({ files: [record("media/a.png"), record("content.db"), record("settings.json")], host: host() });
    expect([...inv.keys()]).toEqual(["media/a.png", "content.db", "settings.json"]);
  });
  it("refuses a file outside the injected roots (mutation: skip-roots-check)", () => {
    expect(() => buildManifestInventory({ files: [record("other/a.png")], host: host() })).toThrow(/Unrecognized or private/);
  });
  it("refuses a path the host marks private after scan-path mapping (mutation: skip-private-check)", () => {
    const h = host({ archiveSecretScanPath: ({ path }) => `private/${path}` });
    expect(() => buildManifestInventory({ files: [record("media/a.png")], host: h })).toThrow(/Unrecognized or private/);
  });
  it("refuses duplicates and the manifest itself", () => {
    expect(() => buildManifestInventory({ files: [record("media/a.png"), record("media/a.png")], host: host() })).toThrow(/Duplicate manifest file/);
    expect(() => buildManifestInventory({ files: [record("manifest.json")], host: host() })).toThrow(/Duplicate manifest file/);
  });
  it("delegates manifest parsing to the host codec", () => {
    expect(parseShareManifest({ manifestBytes: Buffer.from('{"a":1}'), schema: { index: 1, tag: "t" }, host: host() })).toEqual({ a: 1 });
  });
  it("requires the database and a file under every directory", () => {
    const inventory = new Map([["content.db", record("content.db")]]);
    expect(() => checkArchiveMatchesInventory({ inventory, fileAliases: new Set(["manifest.json", "content.db"]), directories: new Set() })).not.toThrow();
    expect(() => checkArchiveMatchesInventory({ inventory: new Map(), fileAliases: new Set(["manifest.json"]), directories: new Set() })).toThrow(/differs from the manifest/);
    expect(() => checkArchiveMatchesInventory({ inventory, fileAliases: new Set(["manifest.json", "content.db"]), directories: new Set(["empty"]) })).toThrow(/Unlisted ZIP directory/);
  });
});

describe("readListedFiles", () => {
  const rec = (path: string, text: string) => ({ path, bytes: Buffer.byteLength(text), sha256: sha256Hex({ bytes: Buffer.from(text) }) });
  const run = (entries: Entry[], inventory: Map<string, ReturnType<typeof rec>>, h = host(), extra: { modified?: Set<string> } = {}) =>
    readListedFiles({ archive: Buffer.alloc(0), reader: reader(entries), inventory, manifestBytes: manifest, host: h, ...extra });
  it("returns verified files and scans non-structured ones under the mapped path", async () => {
    const scan = vi.fn((_required: { path: string; bytes: Uint8Array }) => true as const);
    const inv = new Map([["media/a.png", rec("media/a.png", "abc")], ["content.db", rec("content.db", "db")]]);
    const files = await run([file("manifest.json", "{}"), file("media/a.png", "abc"), file("content.db", "db")], inv, host({ requireShareSecretFree: scan }));
    expect([...files.keys()]).toEqual(["media/a.png", "content.db"]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0]![0]).toMatchObject({ path: "scan/media/a.png" });
  });
  it("refuses changed bytes with the host sentence (mutation: drop-hash-check)", async () => {
    const inv = new Map([["media/a.png", { ...rec("media/a.png", "abc"), sha256: "0".repeat(64) }]]);
    await expect(run([file("media/a.png", "abc")], inv)).rejects.toThrow("Changed since export.");
  });
  it("switches a code unit off instead of refusing when its bytes changed (mutation: ignore-code-unit)", async () => {
    const modified = new Set<string>();
    const inv = new Map([["plugins/p1/a.js", { ...rec("plugins/p1/a.js", "abc"), sha256: "0".repeat(64) }]]);
    await run([file("plugins/p1/a.js", "abc")], inv, host(), { modified });
    expect([...modified]).toEqual(["plugins/p1"]);
  });
  it("refuses unlisted files and a size mismatch", async () => {
    await expect(run([file("media/a.png")], new Map())).rejects.toThrow(/Unlisted ZIP file/);
    await expect(run([file("media/a.png", "abcd")], new Map([["media/a.png", rec("media/a.png", "abc")]]))).rejects.toThrow(/size mismatch/);
  });
  it("counts expanded bytes against the injected budget (mutation: drop-expanded-budget)", async () => {
    const text = "x".repeat(99);
    await expect(run([file("media/a.png", text)], new Map([["media/a.png", rec("media/a.png", text)]]))).rejects.toThrow(/ZIP bomb/);
  });
});

describe("pure helpers", () => {
  it("refuseArchive throws INVALID_ARCHIVE and sha256Hex hashes", () => {
    expect(() => refuseArchive({ message: "no" })).toThrow(SiteShareRefusal);
    expect(sha256Hex({ bytes: Buffer.from("abc") })).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

it("claims explicit archive directories as directories without counting them as files", async () => {
  const claims: Array<{ path: string; directory: boolean }> = [];
  const h = host({ claimSharePath: ({ path, directory, aliases, files }) => {
    claims.push({ path, directory });
    aliases.set(path.toLowerCase(), path);
    if (!directory) files.add(path.toLowerCase());
  } });
  const entries = [file("manifest.json", "{}"), { kind: "directory", entryPath: "media/" } as const, file("media/a.png")];
  const scanned = await scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader(entries), host: h });
  expect(claims).toEqual([
    { path: "manifest.json", directory: false }, { path: "media", directory: true }, { path: "media/a.png", directory: false },
  ]);
  expect([...scanned.directories]).toEqual(["media"]);
  expect([...scanned.fileAliases]).toEqual(["manifest.json", "media/a.png"]);

  await expect(scanArchiveMetadata({ archive: Buffer.alloc(0), reader: reader([...entries, { kind: "directory", entryPath: "media/" }]), host: h })).rejects.toMatchObject({
    code: "INVALID_ARCHIVE", message: "Duplicate directory or file/directory collision.",
  });
});
