import { describe, it, expect, vi } from "vitest";
import { SiteShareRefusal } from "../share-refusal.js";
import { buildShareZip, buildStaticSiteZip, claimArchivePaths, type ShareZipHost, type ShareZipPlan, type ZipFolderFiles } from "../share-zip.js";

const zipNames: ZipFolderFiles = async ({ files }) => new File([JSON.stringify(files.map(f => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name))], "out.zip");
const decode = async (buf: Buffer) => JSON.parse(buf.toString()) as string[];

function host(over: Partial<ShareZipHost> = {}): ShareZipHost {
  return {
    limits: { maxManifestBytes: 1000, maxArchiveBytes: 5000 },
    archiveTooLargeMessage: "archive too big", manifestTooLargeMessage: "manifest too big",
    checkShareLimits: () => {},
    requireShareSecretFree: () => true,
    claimSharePath: ({ path, aliases, files }) => { if (aliases.has(path)) throw new SiteShareRefusal({ code: "UNSAFE_PATH", message: `dup ${path}` }); aliases.set(path, path); files.add(path); },
    buildArchiveManifest: input => JSON.stringify(input),
    runtimeToArchivePath: ({ path }) => path.startsWith("skip/") ? null : path.replace(/^runtime\//, "media/"),
    archiveSecretScanPath: ({ path }) => `scan/${path}`,
    readPlannedFile: async file => file.path.includes("stale") ? { ok: false, message: "changed" } : { ok: true, bytes: Buffer.from(`body:${file.path}`) },
    staticDownloadLayout: () => [{ path: "index.html", content: Buffer.from("<p>hi</p>") }],
    defaultBundledFilePolicy: () => async () => "scan",
    ...over,
  };
}
const plan = (over: Partial<ShareZipPlan> = {}): ShareZipPlan => ({ files: [], database: { bytes: Buffer.from("db") }, totalBytes: 2, schema: { index: 1, tag: "t" }, site: { name: "Demo" }, include: { database: true }, ...over });
const disk = (path: string) => ({ path, bytes: 1 }) as never;

describe("buildShareZip", () => {
  it("encodes buffered files, database, disk files and a manifest listing exact bytes", async () => {
    const zip = vi.fn(zipNames);
    const out = await buildShareZip({ plan: plan({ files: [disk("runtime/a.png"), disk("skip/x")], bufferedFiles: [{ path: "media/b.png", content: Buffer.from("bb") }] }), zip, host: host() });
    expect(await decode(out)).toEqual(["share/media/b.png", "share/content.db", "share/media/a.png", "manifest.json"]);
    expect(zip).toHaveBeenCalledWith({ files: expect.any(Array), maxBytes: 5000 });
  });
  it("lists every entry in the manifest inventory with its sha256 (mutation: drop-inventory-row)", async () => {
    const build = vi.fn(host().buildArchiveManifest);
    await buildShareZip({ plan: plan(), zip: zipNames, host: host({ buildArchiveManifest: build }) });
    expect(build.mock.calls[0]![0].files).toEqual([{ path: "content.db", bytes: 2, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  });
  it("refuses a stale planned file as PLAN_STALE (mutation: ignore-stale)", async () => {
    await expect(buildShareZip({ plan: plan({ files: [disk("runtime/stale.png")] }), zip: zipNames, host: host() })).rejects.toMatchObject({ code: "PLAN_STALE" });
  });
  it("claims archive paths and refuses collisions (mutation: skip-claim)", async () => {
    const buffered = [{ path: "media/a", content: Buffer.from("1") }, { path: "media/a", content: Buffer.from("2") }];
    await expect(buildShareZip({ plan: plan({ bufferedFiles: buffered }), zip: zipNames, host: host() })).rejects.toThrow("dup media/a");
  });
  it("scans non-structured entries under the mapped path but never the database (mutation: scan-structured)", async () => {
    const scan = vi.fn((_required: { path: string; bytes: Uint8Array }) => true as const);
    await buildShareZip({ plan: plan({ files: [disk("runtime/a.png")] }), zip: zipNames, host: host({ requireShareSecretFree: scan }) });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0]![0]).toMatchObject({ path: "scan/media/a.png" });
  });
  it("lets the bundled-file policy skip the secret scan (mutation: ignore-policy-skip)", async () => {
    const scan = vi.fn((_required: { path: string; bytes: Uint8Array }) => true as const);
    await buildShareZip({ plan: plan({ files: [disk("runtime/a.png")] }), zip: zipNames, host: host({ requireShareSecretFree: scan }) }, { bundledFilePolicy: async () => "skip" });
    expect(scan).not.toHaveBeenCalled();
  });
  it("uses the host default policy when none is supplied", async () => {
    const policy = vi.fn(async () => "skip" as const);
    const scan = vi.fn((_required: { path: string; bytes: Uint8Array }) => true as const);
    await buildShareZip({ plan: plan({ files: [disk("runtime/a.png")] }), zip: zipNames, host: host({ requireShareSecretFree: scan, defaultBundledFilePolicy: () => policy }) });
    expect(policy).toHaveBeenCalledTimes(2);
    expect(scan).not.toHaveBeenCalled();
  });
  it("refuses a manifest over the injected cap with the host message (mutation: drop-manifest-cap)", async () => {
    await expect(buildShareZip({ plan: plan(), zip: zipNames, host: host({ limits: { maxManifestBytes: 5, maxArchiveBytes: 5000 } }) })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", message: "manifest too big" });
  });
  it("maps the encoder's size failures to the archive cap message and rethrows others (mutation: drop-archive-cap-mapping)", async () => {
    await expect(buildShareZip({ plan: plan(), zip: async () => { throw new Error("Folder is over the upload limit."); }, host: host() })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", message: "archive too big" });
    await expect(buildShareZip({ plan: plan(), zip: async () => { throw new Error("disk on fire"); }, host: host() })).rejects.toThrow("disk on fire");
  });
  it("records progress totals and counts, and honours abort", async () => {
    const progress = { filesDone: 0, bytesDone: 0 } as { filesDone: number; bytesDone: number; filesTotal?: number; bytesTotal?: number };
    await buildShareZip({ plan: plan(), zip: zipNames, host: host() }, { progress: progress as never });
    expect(progress).toMatchObject({ filesTotal: 1, bytesTotal: 2, filesDone: 1, bytesDone: 2 });
    const controller = new AbortController(); controller.abort();
    await expect(buildShareZip({ plan: plan(), zip: zipNames, host: host() }, { signal: controller.signal })).rejects.toThrow();
  });
  it("passes a static omission explanation into the manifest", async () => {
    const build = vi.fn(host().buildArchiveManifest);
    await buildShareZip({ plan: plan(), zip: zipNames, host: host({ buildArchiveManifest: build }) }, { staticCopy: { reason: "too big" } as never });
    expect(build.mock.calls[0]![0].staticSiteOmitted).toBe("too big");
  });
});

describe("buildStaticSiteZip and claimArchivePaths", () => {
  it("nests the host layout under the copy's folder and omits the manifest", async () => {
    const claim = vi.fn(host().claimSharePath);
    const out = await buildStaticSiteZip({ copy: { filename: "site.zip" } as never, zip: zipNames, host: host({ claimSharePath: claim }) });
    expect(await decode(out)).toEqual(["share/site/index.html"]);
    expect(claim.mock.calls.map(c => c[0].path)).toEqual(["site/index.html"]);
  });
  it("reserves the manifest path only for backups (mutation: always-reserve-manifest)", () => {
    expect(() => claimArchivePaths({ entries: [{ path: "manifest.json" }], host: host() })).toThrow("dup manifest.json");
    expect(() => claimArchivePaths({ entries: [{ path: "manifest.json" }], host: host() }, { manifest: false })).not.toThrow();
  });
});
