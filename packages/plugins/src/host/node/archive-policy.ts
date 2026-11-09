/**
 * @file Bounded plugin ZIP policy. Parsing/streaming is the host-supplied archive reader, never a
 * custom ZIP parser here. Keep unreviewed bytes off disk; the normal installer alone may publish a
 * verified package.
 *
 * Every accepted file is held in memory; nothing is written. Limits: 32 MiB upload, 4096 entries
 * and distinct path prefixes, 16 MiB per file, 64 MiB expanded — the expanded counts use the bytes
 * actually streamed, never only the archive's declared sizes.
 */
import { PluginInstallError } from "./install.js";

/** Largest archive accepted for upload, in bytes (32 MiB). */
export const MAX_PLUGIN_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const SIZE_LIMIT_MESSAGE = "ZIP exceeds the file or expanded size limit.";

/**
 * One entry as the host's archive reader yields it.
 *
 * @agent-note The host's reader classifies each entry. Only `file` and `directory` are accepted;
 * any other kind is refused as a link. A reader that cannot classify special platform entries
 * (device, fifo, link mode bits) must refuse or classify them itself before yielding.
 */
export type PluginArchiveEntry =
  | {
      readonly kind: "file";
      readonly entryPath: string;
      /** The archive format's own claimed size. Never trusted alone: streamed bytes are counted too. */
      readonly declaredSize?: number | undefined;
      /** @agent-note Opened at most once per entry, after the path and declared size pass. */
      readonly openReadStream: (required: Record<string, never>) => AsyncIterable<Uint8Array>;
    }
  | { readonly kind: "directory"; readonly entryPath: string }
  | { readonly kind: "symlink" | "hardlink" | "device" | "fifo"; readonly entryPath: string; readonly linkTarget?: string | undefined };

/**
 * Host-supplied archive reader.
 *
 * @agent-note Fulfilled by the host (for example a ZIP library adapter). `entries` is called exactly
 * once per {@link readPluginArchive} call, with the archive bytes the host passed; entries are
 * consumed in yielded order. Errors it throws that are not `PluginInstallError` become
 * `PLUGIN_ARCHIVE_INVALID`; a `PluginInstallError` it throws passes through unchanged.
 */
export interface PluginArchiveReaderPort {
  entries(required: { readonly archive: Uint8Array }): AsyncIterable<PluginArchiveEntry>;
}

function fail(code: string, message: string): never { throw new PluginInstallError(code, message); }

/** Everything accepted so far; one instance per archive read. */
interface ArchivePolicyState {
  readonly files: Map<string, Buffer>;
  readonly paths: Map<string, "file" | "directory">;
  // A case-insensitive directory alias can merge two trees on macOS/Windows at publication.
  readonly spellings: Map<string, string>;
  entries: number;
  total: number;
}

type FileEntry = Extract<PluginArchiveEntry, { kind: "file" }>;

/** Refuses empty, NUL, absolute, drive-lettered, dot/dot-dot, empty-segment and colon paths. */
function assertInsidePackage(required: { key: string; segments: readonly string[] }): void {
  const { key, segments } = required;
  const unsafeKey = !key || key.includes("\0") || key.startsWith("/") || /^[a-zA-Z]:/.test(key);
  if (unsafeKey || segments.some((s) => !s || s === "." || s === ".." || s.includes(":"))) fail("PLUGIN_PACKAGE_UNSAFE", "ZIP paths must stay inside the package.");
}

/** Records one path prefix's spelling; refuses a second spelling of it and caps distinct prefixes. */
function claimSpelling(required: { spellings: Map<string, string>; prefix: string }): void {
  const { spellings, prefix } = required;
  const lower = prefix.toLowerCase();
  if (spellings.has(lower) && spellings.get(lower) !== prefix) fail("PLUGIN_PACKAGE_UNSAFE", "ZIP has case-aliased paths.");
  spellings.set(lower, prefix);
  if (spellings.size > MAX_ENTRIES) fail("PLUGIN_PACKAGE_TOO_LARGE", "ZIP has too many files and directories.");
}

/** Claims `key` for this entry: no duplicates, aliases, paths through a file, or files over a subtree. */
function claimPath(required: { state: ArchivePolicyState; kind: "file" | "directory"; key: string; segments: readonly string[] }): void {
  const { state, kind, key, segments } = required;
  if (state.paths.has(key)) fail("PLUGIN_PACKAGE_UNSAFE", "ZIP has duplicate paths.");
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    claimSpelling({ spellings: state.spellings, prefix });
    // At i === segments.length the prefix is `key` itself, already refused above if present.
    if (state.paths.get(prefix) === "file") fail("PLUGIN_PACKAGE_UNSAFE", "ZIP path crosses a file.");
  }
  if (kind === "file" && [...state.paths.keys()].some((p) => p.startsWith(key + "/"))) fail("PLUGIN_PACKAGE_UNSAFE", "ZIP file replaces a directory.");
  state.paths.set(key, kind);
}

/** Refuses a declared size that is not a sane integer, exceeds the file cap, or would exceed the total. */
function assertDeclaredSize(required: { declaredSize: number | undefined; total: number }): void {
  const { declaredSize, total } = required;
  if (declaredSize === undefined) return;
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_FILE_BYTES || total + declaredSize > MAX_EXPANDED_BYTES) fail("PLUGIN_PACKAGE_TOO_LARGE", SIZE_LIMIT_MESSAGE);
}

/** Streams one file into memory, counting real bytes against the file and expanded caps. */
async function readFileBytes(required: { state: ArchivePolicyState; entry: FileEntry }): Promise<Buffer> {
  const { state, entry } = required;
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of entry.openReadStream({})) {
    length += chunk.byteLength; state.total += chunk.byteLength;
    if (length > MAX_FILE_BYTES || state.total > MAX_EXPANDED_BYTES) fail("PLUGIN_PACKAGE_TOO_LARGE", SIZE_LIMIT_MESSAGE);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, length);
}

/** Applies the whole policy to one entry, in order, and keeps a file's bytes when it passes. */
async function acceptEntry(required: { state: ArchivePolicyState; entry: PluginArchiveEntry }): Promise<void> {
  const { state, entry } = required;
  state.entries += 1;
  if (state.entries > MAX_ENTRIES) fail("PLUGIN_PACKAGE_TOO_LARGE", "ZIP has too many entries.");
  if (entry.kind !== "file" && entry.kind !== "directory") fail("PLUGIN_PACKAGE_UNSAFE", "ZIP links are not allowed.");
  const name = entry.entryPath.replaceAll("\\", "/");
  const key = entry.kind === "directory" ? name.replace(/\/$/, "") : name;
  const segments = key.split("/");
  assertInsidePackage({ key, segments });
  claimPath({ state, kind: entry.kind, key, segments });
  if (entry.kind === "directory") return;
  assertDeclaredSize({ declaredSize: entry.declaredSize, total: state.total });
  state.files.set(key, await readFileBytes({ state, entry }));
}

/** Required inputs of {@link readPluginArchive}. */
export interface ReadPluginArchiveRequired {
  /** The uploaded archive bytes; read once, through `reader`. */
  readonly archive: Uint8Array;
  /** @agent-note Required; there is no built-in reader. The host owns the ZIP library choice. */
  readonly reader: PluginArchiveReaderPort;
}

/** Optional inputs of {@link readPluginArchive} (none today). */
export type ReadPluginArchiveOptional = Record<string, never>;

/**
 * Reads a plugin archive through the host's reader under the bounded policy, returning the
 * accepted files keyed by package-relative POSIX path.
 *
 * @agent-note Per call: one state, one `reader.entries` iteration, no disk writes, no shared state.
 * Every refusal is a `PluginInstallError` with code `PLUGIN_PACKAGE_TOO_LARGE`,
 * `PLUGIN_PACKAGE_UNSAFE` or `PLUGIN_ARCHIVE_INVALID` (any other reader failure). The upload limit
 * is checked before the reader is called. The host publishes the returned files, if at all.
 */
export async function readPluginArchive(
  required: ReadPluginArchiveRequired,
  _optional: ReadPluginArchiveOptional = {},
): Promise<Map<string, Buffer>> {
  if (required.archive.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) fail("PLUGIN_PACKAGE_TOO_LARGE", "ZIP exceeds the 32 MiB upload limit.");
  const state: ArchivePolicyState = { files: new Map(), paths: new Map(), spellings: new Map(), entries: 0, total: 0 };
  try {
    for await (const entry of required.reader.entries({ archive: required.archive })) await acceptEntry({ state, entry });
    return state.files;
  } catch (error) {
    if (error instanceof PluginInstallError) throw error;
    return fail("PLUGIN_ARCHIVE_INVALID", "ZIP could not be read safely.");
  }
}
