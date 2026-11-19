import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface WritableTreePort {
  lstatSync: (entry: string) => Pick<fs.Stats, 'mode' | 'isSymbolicLink' | 'isDirectory'>;
  chmodSync: (entry: string, mode: number) => void;
  readdirSync: (entry: string) => string[];
}
/** Immutable plugin packages need owner-write permission before unlinking their contents.
 * Never follow links: a website may link to files outside the directory authorized for deletion. */
export function makeDirectoryTreeWritable(
  { root }: { root: string },
  { files = fs }: { files?: WritableTreePort } = {},
): void {
  let stat: ReturnType<WritableTreePort['lstatSync']>;
  try { stat = files.lstatSync(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) return;
  files.chmodSync(root, stat.mode | 0o200);
  if (stat.isDirectory()) {
    for (const child of files.readdirSync(root)) makeDirectoryTreeWritable({ root: path.join(root, child) }, { files });
  }
}
export async function removeDirectoryTree(
  { root }: { root: string },
  { files = fs, remove = (entry: string) => fsp.rm(entry, { recursive: true, force: true }) }:
    { files?: WritableTreePort; remove?: (entry: string) => Promise<void> } = {},
): Promise<void> {
  makeDirectoryTreeWritable({ root }, { files });
  await remove(root);
}
