import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import { createShareSteps, type ShareLedger, type SharePlannedFile, type ShareStepsDeps } from "../share-preparation-steps.js";
import { prepareShareContent } from "../share-preparation.js";
import { SiteShareRefusal } from "../share-refusal.js";

interface File extends SharePlannedFile { scope: string }
interface Collected { files: File[]; skipped: { path: string; reason: string }[]; notices?: string[]; scopeNotes: Record<string, string> }
type Include = { database: boolean; media: boolean; zone: boolean };
type Sources = { siteDir: string };

const dbOps = {} as DbOpsPort;
const MAX = { maxExpandedBytes: 1000, maxManifestBytes: 20, maxDocumentBytes: 10 };
const enc = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const refusal = (code: string, message?: string) => expect.objectContaining({ code, ...(message ? { message } : {}) });

function stepDeps(over: Partial<ShareStepsDeps<Sources, Include, File, Collected>> & { calls?: unknown[]; reads?: Record<string, Buffer> } = {}): ShareStepsDeps<Sources, Include, File, Collected> {
  const reads = over.reads ?? {};
  return {
    limits: MAX,
    messages: { settingsTooLarge: ({ path }) => `host says ${path} is big`, invalidDocument: "host says bad document" },
    checkShareLimits: ({ files }) => { if (files.reduce((sum, file) => sum + file.bytes, 0) > MAX.maxExpandedBytes) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: "over" }); },
    captureDatabaseSnapshot: async (_required, optional) => { over.calls?.push(optional); return { ok: true, bytes: Buffer.from("snap"), watermarkAtCapture: 4 }; },
    collectFiles: async (required) => { over.calls?.push(required.include); return { files: [], skipped: [], scopeNotes: {} }; },
    readPlannedFile: async file => (file.path in reads ? { ok: true, bytes: reads[file.path] as Buffer } : { ok: false, message: "gone" }),
    ...over,
  };
}
const ledger = (): ShareLedger => ({ sizes: [], buffered: [] });
const file = (path: string, bytes = 1, scope = "settings"): File => ({ path, bytes, scope });

describe("share steps", () => {
  it("addBuffered counts the file then checks the host caps (mutation skip-limit-check)", () => {
    const steps = createShareSteps(stepDeps());
    const l = ledger();
    steps.addBuffered({ ledger: l, file: { path: "a", content: Buffer.alloc(900) } });
    expect(() => steps.addBuffered({ ledger: l, file: { path: "b", content: Buffer.alloc(200) } })).toThrow(refusal("LIMIT_EXCEEDED"));
    expect(l.buffered.map(f => f.path)).toEqual(["a"]);
  });

  it("snapshots under the host's expanded cap and the private root (mutation ignore-expanded-cap)", async () => {
    const calls: unknown[] = [];
    const sanitize = async ({ snapshot }: { snapshot: Buffer }) => ({ bytes: snapshot, media: [] });
    const out = await createShareSteps(stepDeps({ calls })).captureProjectedDatabase({ dbOps, sanitize, snapshotRoot: "/private" });
    expect(calls).toEqual([{ maxBytes: 1000, snapshotRoot: "/private" }]);
    expect(out.watermarkAtCapture).toBe(4);
    expect(out.projected.bytes.toString()).toBe("snap");
  });

  it("refuses with the snapshot's own message when it cannot be taken", async () => {
    const steps = createShareSteps(stepDeps({ captureDatabaseSnapshot: async () => ({ ok: false, message: "no snapshot" }) }));
    await expect(steps.captureProjectedDatabase({ dbOps, sanitize: async () => ({ bytes: Buffer.alloc(0), media: [] }), snapshotRoot: "/p" })).rejects.toMatchObject({ code: "DATABASE_SNAPSHOT_FAILED", message: "no snapshot" });
  });

  it("collects with the media scope forced off and refuses a skipped file by name (mutation keep-media-include)", async () => {
    const calls: unknown[] = [];
    const steps = createShareSteps(stepDeps({ calls }));
    await steps.collectShareFiles({ sources: { siteDir: "/s" }, include: { database: true, media: true, zone: true } });
    expect(calls).toEqual([{ database: true, media: false, zone: true }]);
    const skipping = createShareSteps(stepDeps({ collectFiles: async () => ({ files: [], skipped: [{ path: "x/y", reason: "a link" }], scopeNotes: {} }) }));
    await expect(skipping.collectShareFiles({ sources: { siteDir: "/s" }, include: { database: true, media: true, zone: true } })).rejects.toMatchObject({ code: "UNSAFE_FILE", message: "Cannot share 'x/y': a link. Remove it or replace it with a regular file." });
  });

  it("checks a blob size: unsized store, missing, invalid, document cap from the host, checked against the caps (mutation ignore-document-cap)", async () => {
    const steps = createShareSteps(stepDeps());
    const sized = (size: number | null) => ({ get: async () => new Uint8Array(), sizeOf: async () => size });
    await expect(steps.reportedBlobSize({ blobStore: { get: async () => new Uint8Array() }, storageKey: "k", document: false })).rejects.toMatchObject({ code: "UNBOUNDED_MEDIA" });
    await expect(steps.reportedBlobSize({ blobStore: sized(null), storageKey: "k", document: false })).rejects.toMatchObject({ code: "MISSING_MEDIA", message: "Share media 'k' is missing from the blob store." });
    await expect(steps.reportedBlobSize({ blobStore: sized(-1), storageKey: "k", document: false })).rejects.toMatchObject({ code: "UNBOUNDED_MEDIA" });
    await expect(steps.reportedBlobSize({ blobStore: sized(11), storageKey: "k", document: true })).rejects.toMatchObject({ code: "INVALID_DOCUMENT", message: "host says bad document" });
    await expect(steps.reportedBlobSize({ blobStore: sized(0), storageKey: "k", document: true })).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    await expect(steps.reportedBlobSize({ blobStore: sized(10), storageKey: "k", document: true })).resolves.toBe(10);
    await expect(steps.reportedBlobSize({ blobStore: sized(11), storageKey: "k", document: false })).resolves.toBe(11);
    await expect(steps.reportedBlobSize({ blobStore: sized(1001), storageKey: "k", document: false })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("refuses blob bytes whose length or checksum differ (mutation skip-checksum)", async () => {
    const steps = createShareSteps(stepDeps());
    const bytes = Buffer.from("abc");
    const blobStore = { get: async () => new Uint8Array(bytes) };
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await expect(steps.fetchVerifiedBlob({ blobStore, media: { storageKey: "k", sha256 }, size: 3 })).resolves.toEqual(bytes);
    await expect(steps.fetchVerifiedBlob({ blobStore, media: { storageKey: "k", sha256: "0".repeat(64) }, size: 3 })).rejects.toMatchObject({ code: "MEDIA_CHANGED" });
    await expect(steps.fetchVerifiedBlob({ blobStore, media: { storageKey: "k" }, size: 4 })).rejects.toMatchObject({ code: "MEDIA_CHANGED" });
  });

  describe("portable settings", () => {
    const settings = (reads: Record<string, Buffer>, files: File[]) => ({ steps: createShareSteps(stepDeps({ reads })), files, l: ledger() });

    it("shares the config name and only valid provenance, else the folder name (mutation spread-meta)", async () => {
      const { steps, files, l } = settings({ "settings/config.json": enc({ name: "Named", secret: "s" }), "settings/.site-meta.json": enc({ templateId: "t-1", schemaVersion: 3, siteId: "leak", templateVersion: "bad value!", schemaTag: {} }) }, [file("settings/config.json"), file("settings/.site-meta.json")]);
      await expect(steps.addPortableSettings({ files, siteDir: "/x/folder", ledger: l })).resolves.toBe("Named");
      expect(JSON.parse(l.buffered[0]?.content.toString() ?? "")).toEqual({ name: "Named", template: { templateId: "t-1", schemaVersion: 3 } });
      const bare = settings({}, []);
      await expect(bare.steps.addPortableSettings({ files: bare.files, siteDir: "/x/folder", ledger: bare.l })).resolves.toBe("folder");
    });

    it("refuses an oversized settings file with the host wording, a stale file, and a non-object (mutation ignore-settings-cap)", async () => {
      const big = settings({}, [file("settings/config.json", 21)]);
      await expect(big.steps.addPortableSettings({ files: big.files, siteDir: "/s", ledger: big.l })).rejects.toMatchObject({ code: "INVALID_SETTINGS", message: "host says settings/config.json is big" });
      const stale = settings({}, [file("settings/config.json")]);
      await expect(stale.steps.addPortableSettings({ files: stale.files, siteDir: "/s", ledger: stale.l })).rejects.toMatchObject({ code: "PLAN_STALE", message: "gone" });
      for (const body of ["[]", "7", "not json"]) {
        const bad = settings({ "settings/config.json": Buffer.from(body) }, [file("settings/config.json")]);
        await expect(bad.steps.addPortableSettings({ files: bad.files, siteDir: "/s", ledger: bad.l })).rejects.toMatchObject({ code: "INVALID_SETTINGS", message: "Share settings 'settings/config.json' must contain a JSON object." });
      }
    });
  });
});

describe("prepareShareContent", () => {
  const INCLUDE: Include = { database: true, media: true, zone: true };
  const harness = (over: { files?: File[]; projection?: Record<string, unknown>; calls?: string[] } = {}) => {
    const files = over.files ?? [file("settings/config.json", 2, "settings"), file("zone/a.txt", 5, "zone")];
    const steps = createShareSteps(stepDeps({
      reads: { "settings/config.json": enc({ name: "Pre" }) },
      collectFiles: async () => ({ files, skipped: [], notices: ["collected"], scopeNotes: { zone: "note" } }),
    }));
    const deps = {
      include: INCLUDE, steps,
      checkShareLimits: stepDeps().checkShareLimits,
      prepareExtensions: async (required: { files: readonly File[] }) => { over.calls?.push(required.files.map(f => f.path).join(",")); return { files: [...required.files], plugins: [{ id: "p" }], notices: ["ext"] }; },
      bufferArchiveMedia: async () => [{ id: "m", slug: "s", path: "media/m", sha256: "h", workspaceId: "w", storageKey: "k", contentType: "x/y" }],
      runtimeSchema: () => ({ index: 1, tag: "one" }),
    };
    const ports = { dbOps, snapshotRoot: "/p", sources: { siteDir: "/x/site" }, blobStore: {}, imageTransformer: {}, rewriteMedia: async () => Buffer.from("rewritten-bytes"),
      sanitize: async () => ({ bytes: Buffer.from("projected"), media: [{ storageKey: "k" }], archiveMedia: [{ id: "m" }], notices: ["proj"], ...over.projection }) };
    return { deps, ports };
  };

  it("assembles the plan from the host's pieces and names no host version field (mutation add-version-field)", async () => {
    const calls: string[] = [];
    const { deps, ports } = harness({ calls });
    const plan = await prepareShareContent({ ...ports, deps });
    expect(calls).toEqual(["zone/a.txt"]);
    expect(plan.notices).toEqual(["proj", "collected", "ext"]);
    expect(plan).toMatchObject({ target: { kind: "zip" }, profile: "share", include: INCLUDE, skipped: [], scopeNotes: { zone: "note" }, schema: { index: 1, tag: "one" }, site: { name: "Pre", folderName: "site" }, plugins: [{ id: "p" }], media: [{ id: "m", slug: "s", path: "media/m", sha256: "h" }] });
    expect(plan.database.bytes.toString()).toBe("rewritten-bytes");
    expect(plan.bufferedFiles.map(f => f.path)).toEqual(["settings.json"]);
    expect(Object.keys(plan).sort()).toEqual(["bufferedFiles", "createdAt", "credentialWarnings", "database", "files", "include", "media", "notices", "plugins", "profile", "schema", "scopeNotes", "site", "skipped", "target", "totalBytes"]);
  });

  it("sizes the database by the rewritten bytes in the total (mutation skip-rewrite-size)", async () => {
    const { deps, ports } = harness();
    const plan = await prepareShareContent({ ...ports, deps });
    const settingsBytes = plan.bufferedFiles[0]?.content.length ?? 0;
    expect(plan.totalBytes).toBe(5 + "rewritten-bytes".length + settingsBytes);
  });

  it("refuses a projection that has media but no archive metadata (mutation drop-archive-media-guard)", async () => {
    const { deps, ports } = harness({ projection: { archiveMedia: undefined } });
    await expect(prepareShareContent({ ...ports, deps })).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  });

  it("stops before any work when the signal is already aborted", async () => {
    const { deps, ports } = harness();
    await expect(prepareShareContent({ ...ports, deps }, { signal: AbortSignal.abort(new Error("stop")) })).rejects.toThrow("stop");
  });
});
