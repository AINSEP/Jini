import { constants } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { createPackagePathsModule } from "./package-paths.js";
import type { FilesystemPort } from "./ports.js";

const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".csv", ".svg", ".py", ".sh"]);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_WALK_ENTRIES = 4096;
const MAX_WALK_DEPTH = 32;

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

  /** Reject traversal even when normalization would leave it inside the folder. */
  function validateFile(file: string): void {
    if (!file || file.includes("\0") || file.includes("\\") || path.posix.isAbsolute(file) || /^[a-zA-Z]:/.test(file) || file.split("/").some(segment => segment === "..")) {
      throw new Error("File request refused: use a path relative to this skill folder, without traversal or absolute paths.");
    }
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      throw new Error("File request refused: only supported text extensions are readable.");
    }
  }

  /** Open the resolved target with no-follow and read at most cap + 1, including growing files. */
  async function readText(file: string): Promise<string> {
    validateFile(file);
    let absolute: string;
    try {
      absolute = await filesystem.realpath(await assertContainedOnDisk(skillRoot, file));
      // Recheck the canonical target through the same owner before opening it.
      const relative = path.relative(await filesystem.realpath(skillRoot), absolute);
      await assertContainedOnDisk(skillRoot, relative);
      validateFile(relative.split(path.sep).join("/"));
    } catch {
      throw new Error("File request refused: file is missing, unreadable, or resolves outside this skill folder.");
    }
    let handle;
    try {
      handle = await filesystem.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("File request refused: only regular text files are readable.");
      if (stat.size > MAX_FILE_BYTES) throw new Error("File request refused: exceeds the 256 KiB text limit; no content returned.");
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_FILE_BYTES) throw new Error("File request refused: exceeds the 256 KiB text limit; no content returned.");
      const bytes = buffer.subarray(0, length);
      if (bytes.some(byte => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127)) throw new Error("File request refused: binary content cannot be read as text.");
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error("File request refused: binary or invalid UTF-8 content cannot be read as text."); }
    } catch (error) {
      // Never reflect native errors or caller paths: either can contain an absolute host path.
      if (error instanceof Error && error.message.startsWith("File request refused:")) throw error;
      throw new Error("File request refused: file is missing or unreadable.");
    } finally { await handle?.close().catch(() => {}); }
  }

  /** Skip directory symlinks (including cycles); contained file symlinks use the same read guard. */
  async function listFiles(): Promise<{ files: string[]; note?: string }> {
    const files: string[] = [];
    let remaining = MAX_WALK_ENTRIES;
    let incomplete = false;
    async function walk(relative: string, depth: number): Promise<void> {
      if (depth > MAX_WALK_DEPTH || remaining <= 0) { incomplete = true; return; }
      let entries;
      try {
        const directory = relative ? await assertContainedOnDisk(skillRoot, relative) : await filesystem.realpath(skillRoot);
        entries = await filesystem.readdir(directory, { withFileTypes: true });
      } catch { incomplete = true; return; }
      for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (remaining-- <= 0) { incomplete = true; break; }
        const file = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(file, depth + 1);
        else if (file !== "SKILL.md" && (entry.isFile() || entry.isSymbolicLink())) {
          try { await readText(file); files.push(file); } catch { /* Refused files must not be advertised as readable. */ }
        }
      }
    }
    await walk("", 0);
    return { files: files.sort(), ...(incomplete ? { note: "Supporting-file inventory is incomplete: traversal limit reached or a directory is unreadable." } : {}) };
  }

  return {
    async read(_input, options = {}) {
      const listing = await listFiles();
      try { return { ...listing, text: await readText(options.file ?? "SKILL.md") }; }
      catch (error) {
        const refusal = error instanceof Error ? error.message : "File request refused.";
        return { files: listing.files, text: "", note: [refusal, `Valid supporting files: ${listing.files.join(", ") || "(none)"}. Omit file to request SKILL.md.`, listing.note].filter(Boolean).join(" ") };
      }
    },
  };
}
