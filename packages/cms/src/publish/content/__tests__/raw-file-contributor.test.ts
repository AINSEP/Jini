import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";
import { createFileBlobIndex } from "../../transfer/index.js";
import type { PackedEntity, RawFileInverse, RawFilePort } from "../../transfer/index.js";
import { createRawFileContributor } from "../raw-file-contributor.js";
import type { RawFileContributorConfig } from "../raw-file-contributor.js";
import type { PublishContentDeps } from "../type-registry.js";

type Ports = { media?: { repo: unknown; assetBlobRepo: unknown } };
const allow: RawFileContributorConfig<Ports> = {
  policy: { checkRawFilePath: () => null, checkRawValues: () => null },
  limits: { files: 2, bytes: 10, scanBytes: 4 },
  copy: { tooManyFiles: "HOST-COPY: too many files", tooManyBytes: "HOST-COPY: too many bytes" },
  mediaPorts: () => ({ repo: { list: async () => [] }, assetBlobRepo: { findByHash: async () => null } }) as never,
  isDocumentOnlyBlob: async () => false,
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** An in-memory site: path -> bytes, behind the file port the engine drives. */
function memoryFiles(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const inv = (relPath: string): RawFileInverse => {
    const bytes = store.get(relPath);
    return { relPath, sha256: bytes ? sha(bytes) : null, size: bytes?.byteLength ?? 0, mode: 0o644, bytes: bytes ? Buffer.from(bytes).toString("base64") : null } as never;
  };
  const port: RawFilePort = {
    check: async () => null,
    read: async ({ relPath }) => (store.has(relPath) ? { bytes: store.get(relPath)!, mode: 0o644, absPath: `/site/${relPath}` } : null),
    capture: async ({ relPath }) => inv(relPath),
    replace: async ({ relPath, bytes }) => { store.set(relPath, Buffer.from(bytes)); },
    restore: async ({ inverse }) => { const b = (inverse as never as { bytes: string | null }).bytes; if (b === null) store.delete(inverse.relPath); else store.set(inverse.relPath, Buffer.from(b, "base64")); },
  };
  return { port, store };
}

function setup(config: RawFileContributorConfig<Ports>, initial: Record<string, string>, selection: string[], opts: { blobs?: Map<string, Uint8Array> } = {}) {
  const files = memoryFiles(initial);
  const blobs = opts.blobs ?? new Map<string, Uint8Array>();
  const bound = createRawFileContributor<Ports>(config);
  const deps: PublishContentDeps<Ports> = {
    workspaceId: "ws", ports: {}, clock: { nowMs: () => 0 }, idGen: { newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    changeSets: new InMemoryChangeSetRepo(), outbox: { enqueue: async () => {} } as never, authorize: async () => ({ allowed: true, reason: "test" }),
    backstop: { files: files.port, fileBlobIndex: createFileBlobIndex(), inverses: [], fileRollbacks: [], coveredTables: [], coveredRoots: ["themes/"],
      blobs: { exists: async ({ storageKey }: { storageKey: string }) => blobs.has(storageKey), get: async ({ storageKey }: { storageKey: string }) => blobs.get(storageKey) } as never,
      selection: { files: selection } },
  };
  const handler = bound.contributeRawFilePublish().build(deps);
  const pack = async () => { const out: PackedEntity[] = []; for await (const e of handler.pack()) out.push(e); return out; };
  return { files, deps, bound, handler, pack };
}

describe("createRawFileContributor", () => {
  it("packs a selected file with its checksum and requires exactly that blob", async () => {
    const f = setup(allow, { "a.txt": "abc" }, ["a.txt"]);
    const [entity] = await f.pack();
    expect(entity?.requiredBlobs).toEqual([sha(Buffer.from("abc"))]);
    expect(entity?.state).toMatchObject({ path: "a.txt", size: 3, mode: 0o644 });
  });

  it("skips a path with the message the injected path policy returns", async () => {
    const f = setup({ ...allow, policy: { ...allow.policy, checkRawFilePath: ({ relPath }) => (relPath === "x.txt" ? "host path refusal" : null) } }, { "x.txt": "1", "a.txt": "2" }, ["x.txt", "a.txt"]);
    expect((await f.pack()).map((e) => e.id)).toEqual(["a.txt"]);
    expect((await f.handler.listSkipped!())[0]).toMatchObject({ id: "x.txt", reason: "host path refusal" });
  });

  it("refuses a file under a covered root, case-insensitively, before any read", async () => {
    const f = setup(allow, { "Themes/a.css": "x" }, ["Themes/a.css"]);
    expect(await f.pack()).toEqual([]);
    expect((await f.handler.listSkipped!())[0]?.reason).toBe("File 'Themes/a.css' already publishes normally; use Overwrite live in normal publishing.");
  });

  it("throws the injected copy for the file-count limit and for the byte limit", async () => {
    const many = setup(allow, { a: "1", b: "1", c: "1" }, ["a", "b", "c"]);
    await expect(many.pack()).rejects.toThrow("HOST-COPY: too many files");
    const big = setup(allow, { a: "123456", b: "123456" }, ["a", "b"]);
    await expect(big.pack()).rejects.toThrow("HOST-COPY: too many bytes");
  });

  it("scans only files at or under the injected scan limit", async () => {
    const scanned: string[] = [];
    const policy = { ...allow.policy, checkRawValues: ({ values }: { values: Readonly<Record<string, unknown>> }) => { scanned.push(...Object.values(values) as string[]); return null; } };
    const f = setup({ ...allow, policy }, { "s.txt": "abcd", "l.txt": "abcde" }, ["s.txt", "l.txt"]);
    await f.pack();
    expect(scanned).toEqual(["abcd"]);
  });

  it("blocks apply when the host exposes no media stores, so private library bytes are never read", async () => {
    const f = setup({ ...allow, mediaPorts: () => undefined }, { "a.txt": "abc" }, ["a.txt"]);
    const [entity] = await f.pack();
    await expect(f.handler.apply({ entity: entity!, principalId: "u", idempotencyKey: "k" } as never)).rejects.toThrow("Library documents cannot be published");
  });

  it("blocks apply when the injected document-only guard reports the blob private", async () => {
    const f = setup({ ...allow, isDocumentOnlyBlob: async () => true }, { "a.txt": "abc" }, ["a.txt"]);
    const [entity] = await f.pack();
    await expect(f.handler.apply({ entity: entity!, principalId: "u", idempotencyKey: "k" } as never)).rejects.toThrow("Library documents cannot be published");
  });

  it("applies verified bytes, then undo restores the file only while it still matches the send", async () => {
    const bytes = Buffer.from("new");
    const blobs = new Map<string, Uint8Array>();
    const f = setup(allow, { "a.txt": "old" }, [], { blobs });
    const sha256 = sha(bytes);
    const { computeBlobStorageKey } = await import("../../../media/blob-key.js");
    blobs.set(computeBlobStorageKey({ workspaceId: "ws", sha256 }), bytes);
    const { contentHash } = await import("../content-hash.js");
    const state = { path: "a.txt", sha256, size: 3, mode: 0o644 };
    const entity: PackedEntity = { entityType: "raw-file", id: "a.txt", schemaVersion: 1, hashVersion: 1, contentHash: contentHash({ entityType: "raw-file", state }), requiredBlobs: [sha256], state };
    const live = await f.handler.inspect({ id: "a.txt" });
    await f.handler.apply({ entity, principalId: "u", idempotencyKey: "k", expectedVersion: live!.version } as never);
    expect(f.files.store.get("a.txt")!.toString()).toBe("new");
    const inverse = f.deps.backstop!.inverses![0] as { before: RawFileInverse; afterHash: string };
    expect(await f.bound.undoRawFile({ deps: f.deps, entity, before: inverse.before, afterHash: inverse.afterHash })).toBeNull();
    expect(f.files.store.get("a.txt")!.toString()).toBe("old");
    f.files.store.set("a.txt", Buffer.from("edited"));
    expect(await f.bound.undoRawFile({ deps: f.deps, entity, before: inverse.before, afterHash: inverse.afterHash })).toBe("File 'a.txt' changed on live after this send; it was left alone.");
  });
});
