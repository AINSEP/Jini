import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { uploadPlannedContent, type BackupUploadEntry, type PendingFile, type PushFailure, type UploadPlannedContentInput } from "../upload.node.js";

const cancelled: PushFailure = { ok: false, code: "CANCELLED", message: "cancelled by caller" };
const manifestPath = "backup-manifest.json";
const manifestContent = Buffer.from("manifest");

function gate<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function file({ path, bytes }: { path: string; bytes: Uint8Array }): PendingFile {
  return { path, load: async () => ({ ok: true, bytes }) };
}

function fixture({ files }: { files: PendingFile[] }, { uploadBlob }: { uploadBlob?: UploadPlannedContentInput["uploadBlob"] } = {}) {
  const controller = new AbortController();
  const progress = { filesDone: 0, filesTotal: files.length, bytesDone: 0, bytesTotal: 0 };
  const uploads: { path: string; content: Uint8Array }[] = [];
  const inventories: { entries: BackupUploadEntry[] }[] = [];
  let inFlight = 0, maxInFlight = 0;
  const required: UploadPlannedContentInput = {
    files, signal: controller.signal, progress, cancelled,
    uploadBlob: async input => {
      uploads.push(input);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const result = uploadBlob ? await uploadBlob(input) : await Promise.resolve({ ok: true as const, blobSha: `blob-${uploads.length}` });
      inFlight--;
      return result;
    },
    buildManifest: input => {
      inventories.push(input);
      return { path: manifestPath, content: manifestContent };
    },
  };
  return { required, progress, uploads, inventories, controller, maxInFlight: () => maxInFlight };
}

function blobEntry({ path, content, blobSha }: { path: string; content: Uint8Array; blobSha: string }): BackupUploadEntry {
  return { path, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex"), blobSha };
}

// Mutation: skip manifest construction, or count its bytes as content progress.
test("an empty upload builds only the manifest and counts no content progress", async () => {
  const f = fixture({ files: [] });
  const result = await uploadPlannedContent(f.required);
  assert.deepEqual(f.inventories, [{ entries: [] }]);
  assert.deepEqual(f.uploads, [{ path: manifestPath, content: manifestContent }]);
  assert.deepEqual(result, { ok: true, entries: [blobEntry({ path: manifestPath, content: manifestContent, blobSha: "blob-1" })] });
  assert.deepEqual(f.progress, { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 });
});

// Mutations: accept malformed UTF-8/NUL, strip BOM, or reject text at the exact limit.
test("inline text preserves BOM and the exact limit; invalid, NUL and oversized bytes use blobs", async () => {
  const contents = [Buffer.from([0xc3, 0x28]), Buffer.from([0]), Buffer.from("123456789"), Buffer.from("\ufeffok"), Buffer.from("12345678")];
  const names = ["invalid-utf8", "nul", "too-large", "bom", "exact-limit"];
  const f = fixture({ files: contents.map((bytes, i) => file({ path: names[i]!, bytes })) });
  f.progress.bytesTotal = 25;
  const result = await uploadPlannedContent(f.required, { concurrency: 1, inlineTextMaxBytes: 8 });
  assert.ok(result.ok);
  const expected = contents.map((content, i): BackupUploadEntry => i < 3
    ? blobEntry({ path: names[i]!, content, blobSha: `blob-${i + 1}` })
    : { path: names[i]!, text: content.toString("utf8"), bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
  assert.deepEqual(result.entries.slice(0, 5), expected);
  assert.deepEqual(f.inventories, [{ entries: expected }]);
  assert.deepEqual(f.uploads.slice(0, 3).map(entry => entry.content), contents.slice(0, 3));
  assert.deepEqual(f.progress, { filesDone: 5, filesTotal: 5, bytesDone: 25, bytesTotal: 25 });
});

// Mutation: discard a loader refusal and continue to the manifest.
test("a source refusal is returned unchanged before any upload or manifest", async () => {
  const refusal: PushFailure = { ok: false, code: "SOURCE_STALE", message: "source changed" };
  const f = fixture({ files: [{ path: "changed", load: async () => refusal }] });
  assert.equal(await uploadPlannedContent(f.required), refusal);
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(f.inventories, []);
  assert.equal(f.progress.filesDone, 0);
});

// Mutation: drop the failed path prefix or replace the mapped code.
test("a manifest upload refusal keeps its mapped code and names the manifest", async () => {
  const f = fixture({ files: [] }, { uploadBlob: async () => ({ ok: false, code: "HOST_REFUSED", message: "manifest refused" }) });
  assert.deepEqual(await uploadPlannedContent(f.required), {
    ok: false, code: "HOST_REFUSED", message: `uploading '${manifestPath}' failed: manifest refused`,
  });
  assert.deepEqual(f.inventories, [{ entries: [] }]);
});

// Mutation: allow manifest construction when an empty upload is already cancelled.
test("a pre-aborted empty upload constructs no manifest", async () => {
  const f = fixture({ files: [] });
  f.controller.abort();
  assert.equal(await uploadPlannedContent(f.required), cancelled);
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(f.inventories, []);
});

// Mutation: remove the one-worker minimum.
test("zero concurrency still uploads all files sequentially", async () => {
  const f = fixture({ files: [1, 2].map(n => file({ path: `file-${n}`, bytes: Buffer.from([n]) })) });
  const result = await uploadPlannedContent(f.required, { concurrency: 0 });
  assert.ok(result.ok);
  assert.deepEqual(result.entries.map(entry => entry.path), ["file-1", "file-2", manifestPath]);
  assert.equal(f.maxInFlight(), 1);
  assert.equal(f.progress.filesDone, 2);
  assert.equal(f.progress.bytesDone, 2);
  assert.deepEqual(f.inventories, [{ entries: result.entries.slice(0, 2) }]);
});

// Mutations: overwrite the first refusal or let a failed worker take a third file.
test.each([false, true])("simultaneous failures keep the first refusal and take no third file (abort: %s)", async abort => {
  const ready = gate<void>(), release = gate<void>();
  const f = fixture({ files: [1, 2, 3].map(n => file({ path: `file-${n}`, bytes: Buffer.from([n]) })) }, {
    uploadBlob: async ({ path }) => {
      if (f.uploads.length === 2) ready.resolve();
      await release.promise;
      if (abort) f.controller.abort();
      return { ok: false, code: "HOST_REFUSED", message: `refused ${path}` };
    },
  });
  const pending = uploadPlannedContent(f.required, { concurrency: 2 });
  await ready.promise;
  release.resolve();
  assert.deepEqual(await pending, { ok: false, code: "HOST_REFUSED", message: "uploading 'file-1' failed: refused file-1" });
  assert.deepEqual(f.uploads.map(entry => entry.path), ["file-1", "file-2"]);
  assert.deepEqual(f.inventories, []);
  assert.equal(f.progress.filesDone, 0);
});

// Mutation: remove only the aggregate check while leaving the per-file inline limit.
test("inline text stops at 64 MiB including the manifest in the same builder budget", async () => {
  const chunk = Buffer.alloc(32 * 1024 * 1024, "x");
  const contents = [chunk, chunk, Buffer.from("y")];
  const f = fixture({ files: contents.map((bytes, i) => file({ path: `file-${i}`, bytes })) });
  const result = await uploadPlannedContent(f.required, { concurrency: 1, inlineTextMaxBytes: chunk.length });
  assert.ok(result.ok);
  for (const entry of result.entries.slice(0, 2)) {
    assert.ok("text" in entry);
    assert.equal(entry.text.length, chunk.length);
  }
  assert.ok("blobSha" in result.entries[2]!);
  assert.ok("blobSha" in result.entries[3]!);
  assert.deepEqual(f.uploads.map(entry => entry.path), ["file-2", manifestPath]);
  assert.deepEqual(f.inventories, [{ entries: result.entries.slice(0, 3) }]);
  assert.equal(f.progress.bytesDone, 64 * 1024 * 1024 + 1);
  assert.equal(f.progress.filesDone, 3);
});

// Mutation: remove the worker's abort check before taking an index.
test("abort before the first index takes neither loader and sends nothing", async () => {
  const loaded: string[] = [];
  const files: PendingFile[] = ["one", "two"].map(path => ({ path, load: async () => {
    loaded.push(path); return { ok: true, bytes: Buffer.from(path) };
  } }));
  const f = fixture({ files });
  f.controller.abort();
  assert.equal(await uploadPlannedContent(f.required, { concurrency: 1 }), cancelled);
  assert.deepEqual(loaded, []);
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(f.inventories, []);
});

// Mutation: remove the pre-index abort check; the second loader would run.
test("abort during upload lets that upload finish without taking a second index", async () => {
  const entered = gate<void>(), release = gate<void>(), loaded: string[] = [];
  const files: PendingFile[] = ["one", "two"].map(path => ({ path, load: async () => {
    loaded.push(path); return { ok: true, bytes: Buffer.from(path) };
  } }));
  const f = fixture({ files }, { uploadBlob: async () => {
    entered.resolve(); await release.promise; return { ok: true, blobSha: "first" };
  } });
  const pending = uploadPlannedContent(f.required, { concurrency: 1 });
  await entered.promise;
  f.controller.abort();
  release.resolve();
  assert.equal(await pending, cancelled);
  assert.deepEqual(loaded, ["one"]);
  assert.deepEqual(f.uploads.map(entry => entry.path), ["one"]);
  assert.deepEqual(f.inventories, []);
  assert.equal(f.progress.filesDone, 1);
  assert.equal(f.progress.bytesDone, 3);
});

// Mutation: add a signal check immediately after load; the first upload would disappear.
test("abort during a deferred load still uploads that file", async () => {
  const entered = gate<void>(), release = gate<void>(), loaded: string[] = [];
  const files: PendingFile[] = ["one", "two"].map(path => ({ path, load: async () => {
    loaded.push(path); entered.resolve(); await release.promise; return { ok: true, bytes: Buffer.from(path) };
  } }));
  const f = fixture({ files });
  const pending = uploadPlannedContent(f.required, { concurrency: 1 });
  await entered.promise;
  f.controller.abort();
  release.resolve();
  assert.equal(await pending, cancelled);
  assert.deepEqual(loaded, ["one"]);
  assert.deepEqual(f.uploads.map(entry => entry.path), ["one"]);
  assert.deepEqual(f.inventories, []);
  assert.equal(f.progress.filesDone, 1);
  assert.equal(f.progress.bytesDone, 3);
});

// Mutations: remove the SHA promise cache, or append inventory in completion order.
test("in-flight duplicate bytes upload once and manifest inventory stays in index order", async () => {
  const shared = gate<void>(), distinct = gate<void>(), ready = gate<void>(), distinctDone = gate<void>();
  const contents = [Buffer.from("same"), Buffer.from("different"), Buffer.from("same")];
  const f = fixture({ files: contents.map((bytes, i) => file({ path: `file-${i}`, bytes })) }, {
    uploadBlob: async ({ path }) => {
      if (path === manifestPath) return { ok: true, blobSha: "manifest" };
      if (f.uploads.length === 2) ready.resolve();
      if (path === "file-1") { await distinct.promise; distinctDone.resolve(); }
      else await shared.promise;
      return { ok: true, blobSha: path === "file-1" ? "distinct" : "shared" };
    },
  });
  const pending = uploadPlannedContent(f.required, { concurrency: 3 });
  await ready.promise;
  distinct.resolve();
  await distinctDone.promise;
  shared.resolve();
  const result = await pending;
  assert.ok(result.ok);
  assert.deepEqual(f.uploads.map(entry => entry.path), ["file-0", "file-1", manifestPath]);
  const expected = contents.map((content, i) => blobEntry({ path: `file-${i}`, content, blobSha: i === 1 ? "distinct" : "shared" }));
  assert.deepEqual(f.inventories, [{ entries: expected }]);
  assert.deepEqual(result.entries.slice(0, 3), expected);
  assert.equal(f.progress.filesDone, 3);
  assert.equal(f.progress.bytesDone, 17);
});
