import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { CAPTURES_DIR_NAME, captureRootFor, createCaptureFileWriter, type CaptureRootLock } from "../capture-files.js";

/** A per-key serial lock that records what ran under it, standing in for the host's root lock. */
function recordingLock(): CaptureRootLock & { keys: string[]; held: boolean } {
  const tails = new Map<string, Promise<unknown>>();
  const lock = {
    keys: [] as string[],
    held: false,
    async withLock<T>({ key, run }: { key: string; run: () => Promise<T> }): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const next = previous.then(async () => { lock.keys.push(key); lock.held = true; try { return await run(); } finally { lock.held = false; } });
      tails.set(key, next.catch(() => undefined));
      return next;
    },
  };
  return lock;
}

/**
 * @file Where `web_screenshot_page` saves its captures: `<siteDir>/.captures/<date>/<name>.jpg`,
 * written under a real temp directory. Paths come back absolute so a report can cite them.
 */

const cleanups: string[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "web-screenshot-captures-"));
  cleanups.push(dir);
  return dir;
}

test("the captures root is the site folder's .captures directory", () => {
  expect(CAPTURES_DIR_NAME).toBe(".captures");
  expect(captureRootFor({ siteDir: "/sites/demo" })).toBe(path.join("/sites/demo", ".captures"));
});

test("files are written under the root, creating the date folder, and their absolute paths are returned in order", async () => {
  const root = path.join(await tempRoot(), ".captures");
  const save = createCaptureFileWriter({ rootDir: root, lock: recordingLock() });
  const paths = await save({ files: [
    { relPath: "2026-10-08/090507-042-site-desktop-1.jpg", bytes: Buffer.from("one") },
    { relPath: "2026-10-08/090507-042-site-desktop-2.jpg", bytes: Buffer.from("two") },
  ] });
  expect(paths).toEqual([path.join(root, "2026-10-08", "090507-042-site-desktop-1.jpg"), path.join(root, "2026-10-08", "090507-042-site-desktop-2.jpg")]);
  expect(await readFile(paths[0]!, "utf8")).toBe("one");
  expect(await readFile(paths[1]!, "utf8")).toBe("two");
});

test("an existing file is never overwritten", async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, "2026-10-08"), { recursive: true });
  await writeFile(path.join(root, "2026-10-08", "a.jpg"), "earlier");
  await expect(createCaptureFileWriter({ rootDir: root, lock: recordingLock() })({ files: [{ relPath: "2026-10-08/a.jpg", bytes: Buffer.from("later") }] })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path.join(root, "2026-10-08", "a.jpg"), "utf8")).toBe("earlier");
});

test("a relative path that escapes the root is refused before anything is written", async () => {
  const root = await tempRoot();
  for (const relPath of ["../outside.jpg", "/abs.jpg", "2026-10-08/../../x.jpg"]) {
    await expect(createCaptureFileWriter({ rootDir: path.join(root, ".captures"), lock: recordingLock() })({ files: [{ relPath, bytes: Buffer.from("x") }] }), relPath).rejects.toThrow(/escapes the captures folder/);
  }
});

test("one escaping path refuses the whole batch, so no earlier file is written", async () => {
  const root = path.join(await tempRoot(), ".captures");
  await expect(createCaptureFileWriter({ rootDir: root, lock: recordingLock() })({ files: [
    { relPath: "2026-10-08/ok.jpg", bytes: Buffer.from("ok") },
    { relPath: "../escape.jpg", bytes: Buffer.from("x") },
  ] })).rejects.toThrow(/escapes the captures folder/);
  await expect(readFile(path.join(root, "2026-10-08", "ok.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("a capture is staged as .partial and renamed to its final name under the root-keyed lock", async () => {
  const root = path.join(await tempRoot(), ".captures");
  const lock = recordingLock();
  const save = createCaptureFileWriter({ rootDir: root, lock });
  const [written] = await save({ files: [{ relPath: "2026-10-08/a.jpg", bytes: Buffer.from("one") }] });
  expect(lock.keys).toEqual([path.resolve(root)]);
  expect(await readFile(written!, "utf8")).toBe("one");
  expect(await readdir(path.join(root, "2026-10-08"))).toEqual(["a.jpg"]);
});

test("an existing capture blocks publication and the staged .partial is removed", async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, "2026-10-08"), { recursive: true });
  await writeFile(path.join(root, "2026-10-08", "a.jpg"), "earlier");
  await expect(createCaptureFileWriter({ rootDir: root, lock: recordingLock() })({ files: [{ relPath: "2026-10-08/a.jpg", bytes: Buffer.from("later") }] })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readdir(path.join(root, "2026-10-08"))).toEqual(["a.jpg"]);
});
