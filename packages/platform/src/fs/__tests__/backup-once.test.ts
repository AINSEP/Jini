import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { backupOriginalOnce } from "../backup-once.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "jini-backup-once-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("copies the original and preserves that first backup across later edits", async () => {
  const filePath = join(root, "settings.json");
  const backup = filePath + ".jini-backup";
  await writeFile(filePath, '{"theme":"light"}');
  await backupOriginalOnce({ filePath });
  expect(await readFile(backup, "utf8")).toBe('{"theme":"light"}');
  await writeFile(filePath, '{"theme":"dark"}');
  await backupOriginalOnce({ filePath });
  expect(await readFile(backup, "utf8")).toBe('{"theme":"light"}');
  expect(await readFile(filePath, "utf8")).toBe('{"theme":"dark"}');
});

it("propagates a missing original and leaves no backup", async () => {
  const filePath = join(root, "missing.json");
  await expect(backupOriginalOnce({ filePath })).rejects.toMatchObject({ code: "ENOENT", syscall: "copyfile" });
  await expect(readFile(filePath + ".jini-backup")).rejects.toMatchObject({ code: "ENOENT" });
});
