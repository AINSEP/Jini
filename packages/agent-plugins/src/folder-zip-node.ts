import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { FOLDER_MAX_FILES, FOLDER_UNREADABLE, FolderZipError, zipFolderFiles } from "./folder-zip.js";
import { isAgentPluginName } from './core/plugin-name.js';
import { readAgentPluginPortableExtension } from './core/identity-namespace.js';

/** Code-unit order, independent of locale. */
function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

type FolderFilesystem = Pick<typeof fs, "realpath" | "lstat" | "opendir" | "open">;
type FolderCollection = { files: File[]; pending: string[]; entries: number; total: number };

async function readLocalFile(required: {
  filesystem: FolderFilesystem; root: string; filename: string; name: string; total: number; maxBytes: number;
}, _optional: Record<string, never> = {}): Promise<{ file: File; total: number }> {
  const { filesystem, root, filename, name, maxBytes } = required;
  if (await filesystem.realpath(filename) !== filename) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
  // O_NOFOLLOW refuses a file replaced with a symlink between enumeration and opening.
  const file = await filesystem.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
    const total = required.total + info.size;
    if (total > maxBytes) throw new FolderZipError("too-large", "Folder is over the upload limit.");
    // One extra byte detects growth without an unbounded readFile allocation.
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length !== info.size) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
    const picked = new File([new Uint8Array(bytes.subarray(0, length))], name);
    Object.defineProperty(picked, "webkitRelativePath", { value: `folder/${path.relative(root, filename).split(path.sep).join("/")}` });
    return { file: picked, total };
  } finally { await file.close(); }
}

async function collectDirectory(required: {
  filesystem: FolderFilesystem; root: string; directory: string; collection: FolderCollection; maxBytes: number;
}, _optional: Record<string, never> = {}): Promise<void> {
  const { filesystem, root, directory, collection, maxBytes } = required;
  if (!(await filesystem.lstat(directory)).isDirectory() || await filesystem.realpath(directory) !== directory) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
  const handle = await filesystem.opendir(directory);
  // Mutate the traversal's owned buffers so visiting directories does not copy accumulated files.
  for await (const entry of handle) {
    collection.entries += 1;
    if (collection.entries > FOLDER_MAX_FILES) throw new FolderZipError("too-many", `More than ${FOLDER_MAX_FILES} entries.`);
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { collection.pending.push(filename); continue; }
    if (!entry.isFile()) throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
    const result = await readLocalFile({ filesystem, root, filename, name: entry.name, total: collection.total, maxBytes });
    collection.total = result.total;
    collection.files.push(result.file);
  }
}

/** Reads a local folder into the browser upload encoder. Refuses links/special files and bounds
 * entries and bytes before allocation; the resulting ZIP still requires the install validator.
 * @throws {FolderZipError} Empty, unreadable, linked, or over-limit folders.
 * @complexity O(e log e + b) time for e entries and b bytes; O(e + b) space,
 * bounded to 4096 entries and maxBytes. No network I/O.
 */
export async function zipLocalFolder(required: { path: string; maxBytes: number }, _optional: Record<string, never> = {}): Promise<Uint8Array> {
  return encodeLocalFiles({ files: await collectLocalFiles(required), maxBytes: required.maxBytes });
}

/** Shared bounded, no-link directory reader for uploads and customized copies. No writes. */
async function collectLocalFiles(required: { path: string; maxBytes: number }): Promise<File[]> {
  const collection: FolderCollection = { files: [], pending: [], entries: 0, total: 0 };
  try {
    const root = await fs.realpath(required.path);
    collection.pending.push(root);
    while (collection.pending.length) {
      const directory = collection.pending.pop()!;
      await collectDirectory({ filesystem: fs, root, directory, collection, maxBytes: required.maxBytes });
    }
    const { files } = collection;
    // Stable order gives repeat local-folder installs identical ZIP digests.
    files.sort((a, b) => compareCodeUnits(a.webkitRelativePath, b.webkitRelativePath));
    return files;
  } catch (error) {
    if (error instanceof FolderZipError) throw error;
    throw new FolderZipError("unreadable", FOLDER_UNREADABLE);
  }
}

/** Encode through the upload owner, rechecking the byte budget after any transformation. */
async function encodeLocalFiles({ files, maxBytes }: { files: readonly File[]; maxBytes: number }): Promise<Uint8Array> {
  return new Uint8Array(await (await zipFolderFiles({ files, maxBytes })).arrayBuffer());
}

export interface CustomizeAgentPluginFolderInput {
  readonly path: string;
  readonly maxBytes: number;
  readonly name: string;
  readonly identityNamespace: string;
  readonly edit: { readonly path: string; readonly oldString: string; readonly newString: string };
}

/** Replace captured bytes while preserving the upload encoder's relative path. */
function replaceCapturedFile({ file, text }: { file: File; text: string }): File {
  const next = new File([text], file.name);
  Object.defineProperty(next, 'webkitRelativePath', { value: file.webkitRelativePath });
  return next;
}

/** Non-UTF-8 or NUL-bearing bytes are binary; refuse them as a named error, not a decoder TypeError. */
function decodeEditableText(bytes: Uint8Array): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = '\0'; }
  if (text.includes('\0')) throw new FolderZipError('unreadable', 'Binary files cannot be edited as text.');
  return text;
}

/** Require exactly one literal match; `$&` and other replacement syntax remain plain text. */
function customizeText({ text, edit }: { text: string; edit: CustomizeAgentPluginFolderInput['edit'] }): string {
  if (!edit.oldString) throw new FolderZipError('unreadable', 'oldString must not be empty.');
  const index = text.indexOf(edit.oldString);
  if (index < 0 || text.indexOf(edit.oldString, index + edit.oldString.length) >= 0) {
    throw new FolderZipError('unreadable', 'oldString must match exactly once. Read the file and send more context.');
  }
  return text.slice(0, index) + edit.newString + text.slice(index + edit.oldString.length);
}

/** Plugin-level history a fork must not inherit: `renamedFrom` lets a package answer for its old
 * ids (export ownership, saved references) and `supersedes` lets it retire other packages. */
const HISTORICAL_IDENTITY_CLAIMS = ['renamedFrom', 'supersedes'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every host key, not only the requesting host's: a manifest declares one `extensions` entry per
 * host, so a fork read later by another host must not keep that host's publisher id or claims. */
function sanitizeHostIdentities({ extensions, localId }: { extensions: Record<string, unknown>; localId: string }): void {
  for (const extension of Object.values(extensions)) {
    if (!isPlainObject(extension)) continue;
    if ('id' in extension) extension.id = localId;
    for (const claim of HISTORICAL_IDENTITY_CLAIMS) delete extension[claim];
  }
}

/** A fork must not retain its publisher identity or historical aliases and supersession claims.
 * The requesting host always gets a fresh `local/<name>` id, even when the source declared none. */
function customizeManifest({ text, name, identityNamespace }: { text: string; name: string; identityNamespace: string }): string {
  const manifest = JSON.parse(text);
  if (!isAgentPluginName({ value: name }) || manifest.name === name) {
    throw new FolderZipError('unreadable', 'Choose a valid new Agent Plugin id different from the source.');
  }
  manifest.name = name;
  manifest.extensions ??= {};
  if (!isPlainObject(manifest.extensions)) throw new FolderZipError('unreadable', 'plugin.json extensions must be an object.');
  const localId = `local/${name}`;
  // Creating the portable key must preserve the installed copy's capabilities and display copy.
  manifest.extensions[identityNamespace] ??= identityNamespace === 'jini' ? { ...readAgentPluginPortableExtension({ value: manifest }) } : {};
  sanitizeHostIdentities({ extensions: manifest.extensions, localId });
  const host = manifest.extensions[identityNamespace];
  if (isPlainObject(host)) host.id = localId;
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * Fork a captured Agent Plugin package with one exact text edit and a fresh identity.
 * Uses the folder upload reader/encoder; never writes into an immutable installed package.
 * @param required Source folder, byte ceiling, new local id, host namespace and literal edit.
 * @returns ZIP bytes for the existing upload preview/installer. Does not grant bundled trust.
 * @throws {FolderZipError} Unsafe/missing paths, links, non-unique text, identity or size refusal.
 * @complexity O(e log e + b) time and O(e + b) space, bounded by upload entry/byte ceilings.
 * @example zipCustomizedAgentPluginFolder({ path, maxBytes, name: 'my-plugin', identityNamespace: 'host', edit })
 */
export async function zipCustomizedAgentPluginFolder(required: CustomizeAgentPluginFolderInput, _optional: Record<string, never> = {}): Promise<Uint8Array> {
  const files = await collectLocalFiles(required);
  // Match captured package paths, never join a model-supplied edit path onto the filesystem.
  const target = files.findIndex(file => file.webkitRelativePath === `folder/${required.edit.path}`);
  const manifest = files.findIndex(file => file.webkitRelativePath === 'folder/plugin.json');
  if (target < 0 || manifest < 0 || target === manifest) {
    throw new FolderZipError('unreadable', 'Choose an existing package-relative text file other than plugin.json.');
  }
  const text = decodeEditableText(new Uint8Array(await files[target]!.arrayBuffer()));
  files[target] = replaceCapturedFile({ file: files[target]!, text: customizeText({ text, edit: required.edit }) });
  files[manifest] = replaceCapturedFile({ file: files[manifest]!, text: customizeManifest({ text: await files[manifest]!.text(), name: required.name, identityNamespace: required.identityNamespace }) });
  return encodeLocalFiles({ files, maxBytes: required.maxBytes });
}
