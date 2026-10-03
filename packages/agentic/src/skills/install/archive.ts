import type { ArchiveReaderPort } from "./ports.js";
import { decodeSkillBase64, MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_FILE_BYTES, SkillInputError, validateSkillPath, type SkillUploadFile } from "./validation.js";

/** Read bounded archive content only; paths are validated before opening any entry stream. */
export async function readSkillArchive({ base64, archiveReader }: { base64: string; archiveReader: ArchiveReaderPort }, _optional: Record<string, never> = {}): Promise<SkillUploadFile[]> {
  try {
    const reader = await archiveReader.open({ bytes: decodeSkillBase64({ value: base64 }) });
    const files: SkillUploadFile[] = [];
    let total = 0;
    let count = 0;
    try {
      for await (const entry of reader.entries) {
        if (++count > MAX_SKILL_FILES) throw new SkillInputError({ message: "A skill archive may contain at most 256 entries." });
        validateSkillPath({ filePath: entry.path.replace(/\/$/, "") });
        if (entry.kind !== "file" && entry.kind !== "directory") throw new SkillInputError({ message: "Skill archives may contain only regular files and directories." });
        if (entry.kind === "directory") continue;
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SKILL_FILE_BYTES) throw new SkillInputError({ message: "Skill archive file exceeds 1 MiB." });
        const chunks: Buffer[] = [];
        let size = 0;
        {
          for await (const chunk of entry.read({})) {
            size += chunk.length;
            total += chunk.length;
            if (size > MAX_SKILL_FILE_BYTES || total > MAX_SKILL_BYTES) throw new SkillInputError({ message: "Skill archive exceeds its decompressed size limit." });
            chunks.push(Buffer.from(chunk));
          }
        }
        if (size !== entry.size) throw new SkillInputError({ message: "Skill archive file size does not match its metadata." });
        files.push({ path: entry.path, contentBase64: Buffer.concat(chunks).toString("base64") });
      }
      return files;
    } finally { reader.close({}); }
  } catch (error) {
    if (error instanceof SkillInputError) throw error;
    throw new SkillInputError({ message: "Could not read skill ZIP. Use a valid ZIP with regular files only." });
  }
}
