import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { FOLDER_MAX_FILES, FOLDER_UNREADABLE, FolderZipError, zipFolderFiles } from "./folder-zip.js";

/** Reads a local folder into the browser upload encoder. Refuses links/special files and bounds
 * entries and bytes before allocation; the resulting ZIP still requires the install validator.
 * @throws {FolderZipError} Empty, unreadable, linked, or over-limit folders.
 * @complexity O(e log e + b) time for e entries and b bytes; O(e + b) space,
 * bounded to 4096 entries and maxBytes. No network I/O.
 */
export async function zipLocalFolder(required: { path: string; maxBytes: number }, _optional: Record<string, never> = {}): Promise<Uint8Array> {
  const files: File[] = [];
  let entries = 0;
  let total = 0;
  try {
    const root = await fs.realpath(required.path);
    const pending = [root];
    while (pending.length) {
      const directory = pending.pop()!;
      if (!(await fs.lstat(directory)).isDirectory() || await fs.realpath(directory) !== directory) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
      const handle = await fs.opendir(directory);
      for await (const entry of handle) {
        if (++entries > FOLDER_MAX_FILES) throw new FolderZipError("too-many", `More than ${FOLDER_MAX_FILES} entries.`);
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) { pending.push(filename); continue; }
        if (!entry.isFile()) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
        if (await fs.realpath(filename) !== filename) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
        // O_NOFOLLOW refuses a file replaced with a symlink between enumeration and opening.
        const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await file.stat();
          if (!info.isFile()) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
          total += info.size;
          if (total > required.maxBytes) throw new FolderZipError("too-large", "Folder is over the upload limit.");
          // One extra byte detects growth without an unbounded readFile allocation.
          const bytes = Buffer.alloc(info.size + 1);
          let length = 0;
          while (length < bytes.length) {
            const read = await file.read(bytes, length, bytes.length - length, null);
            if (read.bytesRead === 0) break;
            length += read.bytesRead;
          }
          if (length !== info.size) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
          const picked = new File([new Uint8Array(bytes.subarray(0, length))], entry.name);
          Object.defineProperty(picked, "webkitRelativePath", { value: `folder/${path.relative(root, filename).split(path.sep).join("/")}` });
          files.push(picked);
        } finally { await file.close(); }
      }
    }
    // Stable order gives repeat local-folder installs identical ZIP digests.
    files.sort((a, b) => a.webkitRelativePath < b.webkitRelativePath ? -1 : a.webkitRelativePath > b.webkitRelativePath ? 1 : 0);
    return new Uint8Array(await (await zipFolderFiles({ files, maxBytes: required.maxBytes })).arrayBuffer());
  } catch (error) {
    if (error instanceof FolderZipError) throw error;
    throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
  }
}
