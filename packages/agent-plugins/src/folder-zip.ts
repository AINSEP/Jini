/**
 * @file Packs a folder the operator picked (`<input type=file webkitdirectory>`) into one `.zip`
 * `File`, so "Upload a folder" travels the exact path a `.zip` upload does: same size limit, same
 * server-side archive checks, same Preview trust review. The install routes only take
 * `application/zip`, so zipping here keeps one server path instead of adding a second upload format.
 *
 * Stored mode (no compression): the upload limit is on the archive, and a plugin folder is small
 * text, so deflate would add a dependency for little gain. `@jini-ai/ui` has a stored-mode
 * `buildZip`, but it is text-only (it would corrupt an image) and not exported, so this is the
 * binary-safe twin, extracted to Jini so browser and local-folder uploads use the same encoder.
 */

/** Refusals, as dictionary keys the caller translates. */
export const FOLDER_EMPTY = "That folder is empty.";
export const FOLDER_UNREADABLE = "Could not read that folder. Try again.";
/** The archive readers' entry cap (`install-archive.ts`, the Agent Plugins reader): refused here
 *  before any bytes are read. */
export const FOLDER_MAX_FILES = 4096;

export class FolderZipError extends Error {
  constructor(readonly reason: "empty" | "too-large" | "too-many" | "unreadable", message: string) { super(message); }
}

/** 1980-01-01, the earliest DOS date: a fixed stamp, so the same folder always zips to the same
 *  bytes (an all-zero date is month 0, which some readers refuse). */
const DOS_DATE_1980 = (1 << 5) | 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @complexity O(n) in the byte count. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A picked file's path inside the picked folder: `webkitRelativePath` minus the folder's own name,
 *  so the package's files sit at the top of the zip — what a server-path install of that same
 *  folder reads, and where both install routes look for the manifest. */
function entryPath(file: File): { folder: string; path: string } {
  const relative = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
  const slash = relative.indexOf("/");
  return slash < 0 ? { folder: "", path: relative } : { folder: relative.slice(0, slash), path: relative.slice(slash + 1) };
}

/**
 * Zips the files of one picked folder.
 *
 * @param required.files - Every file the folder picker returned.
 * @param required.maxBytes - The upload limit; the folder's raw size alone over it is refused before
 *   reading, and the finished zip is checked again (headers add a little).
 * @returns `<folder>.zip`, typed `application/zip`.
 * @throws {FolderZipError} empty folder, too many files, too large, or a file that could not be read.
 * @complexity O(total bytes).
 */
export async function zipFolderFiles(required: { files: readonly File[]; maxBytes: number }, _optional: Record<string, never> = {}): Promise<File> {
  const { files, maxBytes } = required;
  if (files.length === 0) throw new FolderZipError("empty", FOLDER_EMPTY);
  if (files.length > FOLDER_MAX_FILES) throw new FolderZipError("too-many", `More than ${FOLDER_MAX_FILES} files.`);
  if (files.reduce((sum, file) => sum + file.size, 0) > maxBytes) throw new FolderZipError("too-large", "Folder is over the upload limit.");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let folder = "";
  for (const file of files) {
    const entry = entryPath(file);
    folder ||= entry.folder;
    let data: Uint8Array;
    try { data = new Uint8Array(await file.arrayBuffer()); }
    catch { throw new FolderZipError("unreadable", FOLDER_UNREADABLE); }
    const name = encoder.encode(entry.path);
    const crc = crc32(data);
    // Bit 11: the name is UTF-8, so a reader never decodes it as CP437.
    const flags = name.some((b) => b > 0x7f) ? 0x0800 : 0;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true);
    lv.setUint16(12, DOS_DATE_1980, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    // Version-made-by 20 (MS-DOS, external attributes 0): a plain file to every reader, so the
    // server's Unix special-entry guard never sees a mode to refuse.
    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, flags, true);
    cv.setUint16(14, DOS_DATE_1980, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    header.set(name, 46);
    chunks.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  if (offset + centralSize + end.length > maxBytes) throw new FolderZipError("too-large", "Folder is over the upload limit.");
  return new File([...chunks, ...central, end] as BlobPart[], `${folder || "folder"}.zip`, { type: "application/zip" });
}
