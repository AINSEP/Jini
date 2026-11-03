import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Hash source files and relative names, including additions/deletions. Does not traverse symlinks.
 * Callers supply source roots; generated/dependency trees are skipped. Missing roots contribute
 * their name so creating one invalidates a previous stamp. Filesystem errors otherwise propagate.
 * @complexity O(source bytes + files log files) time, O(largest file + directory depth) space.
 */
export async function sourceTreeStamp({ roots }: { roots: readonly string[] }, _options = {}): Promise<string> {
  const hash = createHash('sha256');
  async function visit(file: string): Promise<void> {
    hash.update(file);
    let info;
    try { info = await lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isFile()) { hash.update(await readFile(file)); return; }
    if (!info.isDirectory()) return;
    for (const name of (await readdir(file)).sort()) {
      if (['node_modules', 'dist', '.git'].includes(name)) continue;
      await visit(path.join(file, name));
    }
  }
  for (const root of roots) await visit(root);
  return hash.digest('hex');
}
