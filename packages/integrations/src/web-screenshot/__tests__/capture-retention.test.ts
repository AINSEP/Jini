import { createCaptureRootFileLock, CAPTURE_LOCK_NAME } from "../capture-root-file-lock.js";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import type { CleanupPreviewStore } from "@jini-ai/core/contracts/storage";

import type { CaptureRootLock } from "../capture-files.js";
import { bindCaptureRetention, createCaptureFilePorts, createCaptureRetention, type CaptureEntry } from "../capture-retention.js";

/**
 * @file Manual screenshot cleanup: preview lists only older, completed, writer-named regular files;
 * apply deletes only what the owner confirmed and what is still byte-for-byte that file. Real temp
 * folders so `lstat` identity, symlinks and `.partial` staging are the real thing.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25);
const OLD = new Date(NOW - 30 * DAY);
const CUTOFF = NOW - 7 * DAY;

const cleanups: string[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function captureRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "capture-retention-"));
  cleanups.push(dir);
  const root = path.join(dir, ".captures");
  await mkdir(path.join(root, "2026-10-01"), { recursive: true });
  return root;
}

async function put(root: string, relPath: string, text: string, when: Date): Promise<void> {
  await mkdir(path.dirname(path.join(root, relPath)), { recursive: true });
  await writeFile(path.join(root, relPath), text);
  await utimes(path.join(root, relPath), when, when);
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

/** Single-use tokens bound to principal, kind and scope, as the platform store behaves. */
function memoryPreviewStore(): CleanupPreviewStore {
  const tokens = new Map<string, { principal: string; kind: string; scope: string; payload: Record<string, unknown> }>();
  let next = 0;
  return {
    put({ principal, kind, scope, payload }) {
      const token = `t${++next}`;
      tokens.set(token, { principal, kind, scope, payload });
      return { token, deadline: NOW + 15 * 60_000 };
    },
    take({ token, principal, kind, scope }) {
      const held = tokens.get(token);
      tokens.delete(token);
      if (!held || held.principal !== principal || held.kind !== kind || held.scope !== scope) return null;
      return { payload: held.payload, deadline: NOW + 15 * 60_000 };
    },
  };
}

function keyLock(): CaptureRootLock & { keys: string[] } {
  const keys: string[] = [];
  return { keys, async withLock({ key, run }) { keys.push(key); return run(); } };
}

function retentionFor(root: string, overrides: { lock?: CaptureRootLock; listOwned?: (r: { root: string }) => Promise<readonly CaptureEntry[]> } = {}) {
  const ports = createCaptureFilePorts({ fs }, {});
  return createCaptureRetention({
    root,
    listOwned: overrides.listOwned ?? ports.listOwned,
    removeOwned: ports.removeOwned,
    previewStore: memoryPreviewStore(),
    clock: () => NOW,
    lock: overrides.lock ?? keyLock(),
  }, {});
}

const who = { principal: "owner-1", scope: "site-a" };

test("preview shows only older completed captures", async () => {
  const root = await captureRoot();
  const outside = path.join(path.dirname(root), "outside.jpg");
  await put(root, "2026-10-01/090000-000-site-desktop.jpg", "old", OLD);
  await put(root, "2026-11-24/090000-000-site-desktop.jpg", "new", new Date(NOW - DAY));
  await put(root, "2026-10-01/090100-000-site-desktop.jpg.partial", "staging", OLD);
  await put(root, "2026-10-01/notes.txt", "mine", OLD);
  await put(root, "loose.jpg", "loose", OLD);
  await writeFile(outside, "elsewhere");
  await symlink(outside, path.join(root, "2026-10-01", "090200-000-site-desktop.jpg"));
  const retention = retentionFor(root);

  const preview = await retention.preview({ ...who, before: CUTOFF }, {});
  expect(preview.items).toEqual(["2026-10-01/090000-000-site-desktop.jpg"]);
  expect(preview.count).toBe(1);
  expect(preview.bytes).toBe(3);

  const result = await retention.apply({ ...who, previewToken: preview.previewToken, confirm: true }, {});
  expect(result.deleted).toEqual(["2026-10-01/090000-000-site-desktop.jpg"]);
  expect(await exists(path.join(root, "2026-10-01/090000-000-site-desktop.jpg"))).toBe(false);
  for (const kept of ["2026-11-24/090000-000-site-desktop.jpg", "2026-10-01/090100-000-site-desktop.jpg.partial", "2026-10-01/notes.txt", "loose.jpg"]) {
    expect(await exists(path.join(root, kept)), kept).toBe(true);
  }
  expect(await readFile(outside, "utf8")).toBe("elsewhere");
});

test("replaced capture is kept", async () => {
  const root = await captureRoot();
  const rel = "2026-10-01/090000-000-site-desktop.jpg";
  await put(root, rel, "first", OLD);
  const retention = retentionFor(root);
  const preview = await retention.preview({ ...who, before: CUTOFF }, {});
  expect(preview.items).toEqual([rel]);

  await rm(path.join(root, rel));
  await put(root, rel, "second picture", OLD);

  const result = await retention.apply({ ...who, previewToken: preview.previewToken, confirm: true }, {});
  expect(result.deleted).toEqual([]);
  expect(result.kept).toEqual([{ relPath: rel, reason: "changed" }]);
  expect(await readFile(path.join(root, rel), "utf8")).toBe("second picture");
});

test("in-progress capture is kept", async () => {
  const root = await captureRoot();
  const partial = "2026-10-01/090000-000-site-desktop.jpg.partial";
  await put(root, partial, "half", OLD);
  const retention = retentionFor(root);
  const preview = await retention.preview({ ...who, before: CUTOFF }, {});
  expect(preview.items).toEqual([]);
  const result = await retention.apply({ ...who, previewToken: preview.previewToken, confirm: true }, {});
  expect(result.deleted).toEqual([]);
  expect(await readFile(path.join(root, partial), "utf8")).toBe("half");
});

test("preview and apply both run under the lock keyed by the captures root", async () => {
  const root = await captureRoot();
  await put(root, "2026-10-01/a.jpg", "a", OLD);
  const lock = keyLock();
  const retention = retentionFor(root, { lock });
  const preview = await retention.preview({ ...who, before: CUTOFF }, {});
  await retention.apply({ ...who, previewToken: preview.previewToken, confirm: true }, {});
  expect(lock.keys).toEqual([path.resolve(root), path.resolve(root)]);
});

test("apply without confirm, with a stale token, or as someone else deletes nothing", async () => {
  const root = await captureRoot();
  await put(root, "2026-10-01/a.jpg", "a", OLD);
  const retention = retentionFor(root);
  const preview = await retention.preview({ ...who, before: CUTOFF }, {});
  await expect(retention.apply({ ...who, previewToken: preview.previewToken, confirm: false }, {})).rejects.toThrow(/Confirm the screenshot preview first/);
  await expect(retention.apply({ principal: "owner-2", scope: "site-a", previewToken: preview.previewToken, confirm: true }, {})).rejects.toThrow(/out of date\. Preview again/);
  await expect(retention.apply({ ...who, previewToken: "unknown", confirm: true }, {})).rejects.toThrow(/out of date\. Preview again/);
  expect(await exists(path.join(root, "2026-10-01/a.jpg"))).toBe(true);
});

test("a cutoff in the future is refused", async () => {
  const retention = retentionFor(await captureRoot());
  await expect(retention.preview({ ...who, before: NOW + 1 }, {})).rejects.toThrow(/already passed/);
  await expect(retention.preview({ ...who, before: Number.NaN }, {})).rejects.toThrow(/already passed/);
});

test("entries a lister reports outside the root or through a symlinked folder are never offered", async () => {
  const root = await captureRoot();
  const outsideDir = path.join(path.dirname(root), "elsewhere");
  await put(path.dirname(root), "elsewhere/a.jpg", "x", OLD);
  await symlink(outsideDir, path.join(root, "2026-09-01"));
  const ports = createCaptureFilePorts({ fs }, {});
  const listed = await ports.listOwned({ root }, {});
  expect(listed.some((entry) => entry.relPath.startsWith("2026-09-01/"))).toBe(false);
  const escaping: CaptureEntry = { relPath: "2026-10-01/../../elsewhere/a.jpg", kind: "file", identity: "x", mtimeMs: OLD.getTime(), size: 1 };
  const retention = retentionFor(root, { listOwned: async () => [...listed, escaping] });
  expect((await retention.preview({ ...who, before: CUTOFF }, {})).items).toEqual([]);
});

test("preview offers at most `limit` captures, oldest first", async () => {
  const root = await captureRoot();
  await put(root, "2026-10-01/b.jpg", "b", new Date(OLD.getTime() + 1000));
  await put(root, "2026-10-01/a.jpg", "a", OLD);
  const ports = createCaptureFilePorts({ fs }, {});
  const retention = createCaptureRetention({ root, ...ports, previewStore: memoryPreviewStore(), clock: () => NOW, lock: keyLock() }, { limit: 1 });
  expect((await retention.preview({ ...who, before: CUTOFF }, {})).items).toEqual(["2026-10-01/a.jpg"]);
});

test("owner refusal precedes every filesystem operation", async () => {
  const reads: string[] = [];
  const binding = bindCaptureRetention({ siteDir: "/site", captureRootFor: () => "/site/.captures", writerFence: keyLock(),
    fs: { readdir: async file => { reads.push(file); return []; }, lstat: async file => { reads.push(file); throw new Error("unexpected stat"); }, unlink: async file => { reads.push(file); } },
    clock: () => NOW, previewStore: memoryPreviewStore(), authorizeOwner: () => { throw new Error("owner only"); } });
  await expect(binding.preview({ context: {}, before: CUTOFF })).rejects.toThrow("owner only");
  expect(reads).toEqual([]);
});

test("preview tokens bind to one capture root and writer/cleanup use the same resolved lock path", async () => {
  const first = await captureRoot();
  const second = await captureRoot();
  const paths: string[] = [];
  const fence = createCaptureRootFileLock({ withFileLock: async ({ lockPath, run }, options) => { expect(options).toEqual({ createParent: true }); paths.push(lockPath); return run(); } });
  await fence.withLock({ key: path.join(first, "."), run: () => put(first, "2026-10-01/shot.jpg", "image", OLD) });
  const previewStore = memoryPreviewStore();
  const binding = bindCaptureRetention({ siteDir: first, captureRootFor: ({ siteDir }) => path.join(siteDir, "."), writerFence: fence, fs,
    clock: () => NOW, previewStore, authorizeOwner: () => ({ principal: "owner" }) });
  const other = bindCaptureRetention({ siteDir: second, captureRootFor: ({ siteDir }) => siteDir, writerFence: fence, fs,
    clock: () => NOW, previewStore, authorizeOwner: () => ({ principal: "owner" }) });
  const firstPreview = await binding.preview({ context: {}, before: CUTOFF });
  await expect(other.apply({ context: {}, previewToken: firstPreview.previewToken, confirm: true })).rejects.toThrow("out of date");
  const next = await binding.preview({ context: {}, before: CUTOFF });
  expect(await binding.apply({ context: {}, previewToken: next.previewToken, confirm: true })).toEqual({ deleted: ["2026-10-01/shot.jpg"], kept: [] });
  expect(paths).toEqual(Array(4).fill(path.join(path.resolve(first), CAPTURE_LOCK_NAME)));
});
