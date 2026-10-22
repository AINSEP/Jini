import type { ArchiveEntry, ArchiveReaderPort } from "./ports.js";
import { decodeSkillBase64, MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_FILE_BYTES, SkillInputError, validateSkillPath, type SkillUploadFile } from "./validation.js";

/** Read bounded archive content only; paths are validated before opening any entry stream. */
export async function readSkillArchive({ base64, archiveReader }: { base64: string; archiveReader: ArchiveReaderPort }, _optional: Record<string, never> = {}): Promise<SkillUploadFile[]> {
  try {
    const reader = await archiveReader.open({ bytes: decodeSkillBase64({ value: base64 }) });
    try {
      return await collectArchiveFiles({ entries: reader.entries });
    } finally { reader.close({}); }
  } catch (error) {
    // Converts malformed archive parser failures into a client-actionable validation refusal.
    if (error instanceof SkillInputError) throw error;
    throw new SkillInputError({ message: "Could not read skill ZIP. Use a valid ZIP with regular files only." }, { cause: error });
  }
}

/** Walks every entry (directories count toward the entry limit) and reads the regular files.
 * @complexity O(entries + decompressed bytes), bounded to 256 entries and 8 MiB.
 */
async function collectArchiveFiles({ entries }: { entries: AsyncIterable<ArchiveEntry> }): Promise<SkillUploadFile[]> {
  const files: SkillUploadFile[] = [];
  const budget = { total: 0 };
  let count = 0;
  for await (const entry of entries) {
    if (++count > MAX_SKILL_FILES) throw new SkillInputError({ message: "A skill archive may contain at most 256 entries." });
    if (isRegularFileEntry({ entry })) files.push(await readArchiveFile({ entry, budget }));
  }
  return files;
}

/** Validates the entry path before its kind; refuses anything but files and directories. */
function isRegularFileEntry({ entry }: { entry: ArchiveEntry }): boolean {
  validateSkillPath({ filePath: entry.path.replace(/\/$/, "") });
  if (entry.kind !== "file" && entry.kind !== "directory") throw new SkillInputError({ message: "Skill archives may contain only regular files and directories." });
  return entry.kind === "file";
}

/** Streams one file under its own 1 MiB cap and the archive-wide budget, then checks metadata. */
async function readArchiveFile({ entry, budget }: { entry: ArchiveEntry; budget: { total: number } }): Promise<SkillUploadFile> {
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SKILL_FILE_BYTES) throw new SkillInputError({ message: "Skill archive file exceeds 1 MiB." });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of entry.read({})) {
    size += chunk.length;
    budget.total += chunk.length;
    if (size > MAX_SKILL_FILE_BYTES || budget.total > MAX_SKILL_BYTES) throw new SkillInputError({ message: "Skill archive exceeds its decompressed size limit." });
    chunks.push(Buffer.from(chunk));
  }
  if (size !== entry.size) throw new SkillInputError({ message: "Skill archive file size does not match its metadata." });
  return { path: entry.path, contentBase64: Buffer.concat(chunks).toString("base64") };
}
