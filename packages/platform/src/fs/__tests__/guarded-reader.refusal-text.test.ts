/** B046: refusals are model-visible text, so they name the caller's relative path and a plain reason —
 * never the native error message, which carries the absolute host path. */
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, FsFilePathError, type GuardedReaderFilesystem } from "../guarded-reader.js";

const denyRules = { segments: new Set<string>(), filenamePatterns: [] as RegExp[] };
const limits = { maxFileBytes: 1024, binarySniffBytes: 16, maxListedFiles: 10, maxWalkDepth: 4, maxWalkEntries: 20 };
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) nodeFs.rmSync(dir, { recursive: true, force: true }); });

function tempRoot(): string {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "guarded-refusal-"));
  roots.push(dir);
  return dir;
}

function reader(rootPath: string, filesystem: Partial<GuardedReaderFilesystem>) {
  return createGuardedFileReader({ rootPath, denyRules, limits, filesystem: { ...createNodeGuardedReaderFilesystem({}), ...filesystem } });
}

async function refusalOf(action: () => unknown): Promise<FsFilePathError> {
  try { await action(); } catch (error) { if (error instanceof FsFilePathError) return error; throw error; }
  throw new Error("expected a refusal");
}

test("a file that vanishes before it is opened is refused without the absolute temp path", async () => {
  const rootPath = tempRoot();
  const target = path.join(rootPath, "gone.txt");
  nodeFs.writeFileSync(target, "abc");
  // Removed after the stat and before the open: the native ENOENT message names the absolute path.
  const createReadStream = ((file: string, options: unknown) => {
    nodeFs.unlinkSync(target);
    return nodeFs.createReadStream(file, options as never);
  }) as GuardedReaderFilesystem["createReadStream"];

  const refusal = await refusalOf(() => reader(rootPath, { createReadStream }).readBytes({ relativePath: "gone.txt", maxBytes: 8 }));

  expect(refusal.message).not.toContain(rootPath);
  expect(refusal.message).not.toContain(nodeFs.realpathSync(os.tmpdir()));
  expect(refusal.message).toBe("path 'gone.txt' could not be read: it does not exist (ENOENT)");
});

test("a stat failure is refused with a plain reason, not the native message", async () => {
  const rootPath = tempRoot();
  nodeFs.writeFileSync(path.join(rootPath, "locked.txt"), "abc");
  const statSync = ((file: string) => {
    throw Object.assign(new Error(`EACCES: permission denied, stat '${file}'`), { code: "EACCES" });
  }) as GuardedReaderFilesystem["statSync"];

  const refusal = await refusalOf(() => reader(rootPath, { statSync }).read({ relativePath: "locked.txt" }));

  expect(refusal.message).not.toContain(rootPath);
  expect(refusal.message).toBe("path 'locked.txt' could not be read: permission was denied (EACCES)");
});
