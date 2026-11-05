import { constants, promises as fs } from 'node:fs';

/** Preserve the original before a personal-config change; never replace the first backup.
 * Call under the destination's write lock. Only an existing backup is ignored.
 * @complexity O(file bytes) time, O(1) space; one exclusive filesystem copy.
 */
export async function backupOriginalOnce(
  { filePath }: { filePath: string }, _options: Record<string, never> = {},
): Promise<void> {
  await fs.copyFile(filePath, `${filePath}.jini-backup`, constants.COPYFILE_EXCL)
    .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
}
