import { constants, type Dirent } from "node:fs";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { createPackagePathsModule } from "./package-paths.js";
import type { FilesystemPort } from "./ports.js";

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".csv", ".svg", ".py", ".sh"]);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_WALK_ENTRIES = 4096;
const MAX_WALK_DEPTH = 32;
const TOO_LARGE = "File request refused: exceeds the 256 KiB text limit; no content returned.";

const UNREADABLE = "File request refused: file is missing or unreadable.";

/** A read either yields text or the one refusal message the model may see. */
type ReadOutcome = { readonly text: string } | { readonly refusal: string };

/** Reads an opened regular file of at most the cap; a file that grows past it after `stat` is still refused. */
async function readOpened(handle: FileHandle): Promise<ReadOutcome> {
  const stat = await handle.stat();
  if (!stat.isFile()) return { refusal: "File request refused: only regular text files are readable." };
  if (stat.size > MAX_FILE_BYTES) return { refusal: TOO_LARGE };
  const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
    if (!bytesRead) break;
    length += bytesRead;
  }
  return length > MAX_FILE_BYTES ? { refusal: TOO_LARGE } : decodeText(buffer.subarray(0, length));
}

/** Whitespace control bytes text may carry: tab, LF and CR. */
const TEXT_CONTROL_BYTES: ReadonlySet<number> = new Set([9, 10, 13]);
function isControlByte(byte: number): boolean {
  return byte === 127 || (byte < 32 && !TEXT_CONTROL_BYTES.has(byte));
}

/** Admit only control-free UTF-8 text (tab, LF and CR allowed). */
function decodeText(bytes: Buffer): ReadOutcome {
  if (bytes.some(isControlByte)) return { refusal: "File request refused: binary content cannot be read as text." };
  try { return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }; }
  catch { return { refusal: "File request refused: binary or invalid UTF-8 content cannot be read as text." }; }
}

/** Model-visible result. Paths are relative to ONE skill; filesystem errors never cross this seam. */
export interface SkillFileResult {
  readonly text: string;
  readonly files: readonly string[];
  readonly note?: string;
}
export interface SkillFileReader {
  read(input: Record<string, never>, options?: { readonly file?: string }): Promise<SkillFileResult>;
}

/**
 * Progressive disclosure for plugin AND standalone skills, with a skill-folder trust boundary.
 * Uses the lifecycle containment owner, native bounded reads and injected async filesystem effects.
 * The default file is SKILL.md; supporting files are discovered recursively, never inlined.
 * @complexity O(entries + readable bytes), bounded by 4096 entries, depth 32 and 256 KiB per file.
 */
export function createSkillFileReader(
  { skillRoot, filesystem }: { readonly skillRoot: string; readonly filesystem: FilesystemPort },
  _options: Record<string, never> = {},
): SkillFileReader {
  const { assertContainedOnDisk } = createPackagePathsModule({ filesystem });

  /** Reject traversal even when normalization would leave it inside the folder.
   * @returns The refusal message, or `undefined` for an admissible name. */
  function validateFile(file: string): string | undefined {
    const absolute = path.posix.isAbsolute(file) || /^[a-zA-Z]:/.test(file);
    if (!file || /[\0\\]/.test(file) || absolute || file.split("/").some(segment => segment === "..")) {
      return "File request refused: use a path relative to this skill folder, without traversal or absolute paths.";
    }
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      return "File request refused: only supported text extensions are readable.";
    }
    return undefined;
  }

  /** The canonical contained target of `file`, or `undefined` when it is missing or escapes the folder. */
  async function resolveTarget(file: string): Promise<string | undefined> {
    try {
      const absolute = await filesystem.realpath(await assertContainedOnDisk(skillRoot, file));
      // Recheck the canonical target through the same owner before opening it.
      const relative = path.relative(await filesystem.realpath(skillRoot), absolute);
      await assertContainedOnDisk(skillRoot, relative);
      return validateFile(relative.split(path.sep).join("/")) === undefined ? absolute : undefined;
    } catch {
      return undefined;
    }
  }

  /** Validate, resolve, then read one file; every refusal is a value, never a thrown native error. */
  async function readText(file: string): Promise<ReadOutcome> {
    const invalid = validateFile(file);
    if (invalid !== undefined) return { refusal: invalid };
    const absolute = await resolveTarget(file);
    if (absolute === undefined) return { refusal: "File request refused: file is missing, unreadable, or resolves outside this skill folder." };
    return readContained(absolute);
  }

  /** Open the resolved target with no-follow and read at most cap + 1, including growing files. */
  async function readContained(absolute: string): Promise<ReadOutcome> {
    const handle = await filesystem.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
    if (!handle) return { refusal: UNREADABLE };
    // Never reflect native errors or caller paths: either can contain an absolute host path.
    return readOpened(handle).catch(() => ({ refusal: UNREADABLE })).finally(() => handle.close().catch(() => {}));
  }

  /** Skip directory symlinks (including cycles); contained file symlinks use the same read guard. */
  async function listFiles(): Promise<{ files: string[]; note?: string }> {
    const files: string[] = [];
    let remaining = MAX_WALK_ENTRIES;
    let incomplete = false;
    async function walk(relative: string, depth: number): Promise<void> {
      if (depth > MAX_WALK_DEPTH || remaining <= 0) { incomplete = true; return; }
      const entries = await readDirectory(relative);
      if (!entries) { incomplete = true; return; }
      for (const entry of entries) {
        const exhausted = remaining <= 0;
        remaining -= 1;
        if (exhausted) { incomplete = true; break; }
        await visit(entry, relative ? `${relative}/${entry.name}` : entry.name, depth);
      }
    }
    async function visit(entry: Dirent, file: string, depth: number): Promise<void> {
      if (entry.isDirectory()) {
        await walk(file, depth + 1);
        return;
      }
      if (file === "SKILL.md" || !(entry.isFile() || entry.isSymbolicLink())) return;
      // Refused files must not be advertised as readable.
      if ("text" in await readText(file)) files.push(file);
    }
    await walk("", 0);
    return { files: files.sort(), ...(incomplete ? { note: "Supporting-file inventory is incomplete: traversal limit reached or a directory is unreadable." } : {}) };
  }

  /** One directory's entries in code-unit name order, or `undefined` when it cannot be read. */
  async function readDirectory(relative: string): Promise<Dirent[] | undefined> {
    try {
      const directory = relative ? await assertContainedOnDisk(skillRoot, relative) : await filesystem.realpath(skillRoot);
      return (await filesystem.readdir(directory, { withFileTypes: true })).sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name));
    } catch { return undefined; }
  }

  return {
    async read(_input, options = {}) {
      const listing = await listFiles();
      const outcome = await readText(options.file ?? "SKILL.md");
      if ("text" in outcome) return { ...listing, text: outcome.text };
      return { files: listing.files, text: "", note: [outcome.refusal, `Valid supporting files: ${listing.files.join(", ") || "(none)"}. Omit file to request SKILL.md.`, listing.note].filter(Boolean).join(" ") };
    },
  };
}
