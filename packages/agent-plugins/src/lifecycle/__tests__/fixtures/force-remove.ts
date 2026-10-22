import type { Dirent } from "node:fs";
import { chmod, readdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * @file Test-only cleanup shared across every test file in this feature that installs a real
 * package: a successful install deliberately freezes its published package root read-only
 * (`install.ts`'s `freezeTree`), so a plain recursive `rm` on the enclosing temp dir fails EACCES
 * trying to unlink/rmdir inside it — that failure is proof the freeze worked, not a bug. Restores
 * write permission everywhere under `root` first, then removes it. Extracted here after the same
 * helper was independently duplicated across three test files.
 */
export async function forceRemove(root: string): Promise<void> {
  async function makeWritable(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await chmod(dir, 0o700).catch(() => undefined);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await makeWritable(absolute);
      else await chmod(absolute, 0o600).catch(() => undefined);
    }
  }
  await makeWritable(root);
  await rm(root, { recursive: true, force: true });
}
