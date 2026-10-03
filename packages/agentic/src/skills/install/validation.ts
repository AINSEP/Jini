/** Bounded skill-bundle validation; scripts are stored as data and never executed. */
import path from "node:path";
import type { YamlReaderPort } from "./ports.js";

export type SkillYamlPort = YamlReaderPort;
export class SkillInputError extends Error {
  constructor({ message }: { message: string }, optional: { cause?: unknown } = {}) {
    super(message, optional);
  }
}
export interface SkillUploadFile { readonly path: string; readonly contentBase64: string }
export const MAX_SKILL_BYTES = 8 * 1024 * 1024;
export const MAX_SKILL_FILES = 256;
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".svg", ".sh", ".py", ".js", ".ts", ".mjs"]);
const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** Decodes bounded canonical base64; malformed encodings never silently turn into empty files. */
export function decodeSkillBase64({ value }: { value: string }, { maxBytes = MAX_SKILL_BYTES }: { maxBytes?: number } = {}): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4) throw new SkillInputError({ message: "Skill upload exceeds its size limit." });
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new SkillInputError({ message: "Skill upload must use valid base64." });
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes) throw new SkillInputError({ message: "Skill upload exceeds its size limit." });
  return bytes;
}

export function validateSkillPath({ filePath }: { filePath: string }, _optional: Record<string, never> = {}): void {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 240 || /[\\\x00-\x1f\x7f:]/.test(filePath) || path.posix.isAbsolute(filePath) || filePath.split("/").some(p => !p || p === "." || p === ".." || p.startsWith("."))) throw new SkillInputError({ message: `Unsafe skill file path: ${filePath}` });
}

/** Strict frontmatter for new installs; the legacy disk loader remains backwards compatible. */
export function validateSkillMarkdown({ markdown, yamlReader }: { markdown: string; yamlReader: YamlReaderPort }, _optional: Record<string, never> = {}): { name: string; description: string } {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new SkillInputError({ message: "SKILL.md must have YAML frontmatter with a name and description." });
  let fields: unknown;
  try { fields = yamlReader.read({ yaml: frontmatter[1]! }); }
  catch { throw new SkillInputError({ message: "SKILL.md must have valid YAML frontmatter." }); }
  const { name, description } = (fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>;
  if (typeof name !== "string" || typeof description !== "string" || !description.trim()) throw new SkillInputError({ message: "SKILL.md must have YAML frontmatter with a name and description." });
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new SkillInputError({ message: "Skill name must use lowercase letters, digits and single hyphens (1–64 characters)." });
  if (description.length > 1024) throw new SkillInputError({ message: "Skill description exceeds 1024 characters." });
  return { name, description: description.replace(/\s+/g, " ").trim() };
}

/** Validates the whole package before writes, including cross-file collisions and combined limits.
 * @complexity O(total bytes + files × path length), bounded to 8 MiB / 256 files.
 */
export function validateSkillFiles({ files: upload, yamlReader }: { files: readonly SkillUploadFile[]; yamlReader: YamlReaderPort }, _optional: Record<string, never> = {}) {
  if (!Array.isArray(upload) || upload.length === 0 || upload.length > MAX_SKILL_FILES) throw new SkillInputError({ message: "A skill must contain 1–256 files." });
  for (const file of upload) validateSkillPath({ filePath: file.path });
  const skillFiles = upload.filter(f => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"));
  if (skillFiles.length !== 1) {
    if (skillFiles.length > 1 && new Set(skillFiles.map(f => f.path)).size === 1) throw new SkillInputError({ message: `Duplicate skill file path: ${skillFiles[0]!.path}` });
    throw new SkillInputError({ message: "Choose one skill folder containing a single SKILL.md." });
  }
  const prefix = skillFiles[0]!.path.slice(0, -"SKILL.md".length);
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const file of upload) {
    if (!file.path.startsWith(prefix)) throw new SkillInputError({ message: "All files must belong to the selected skill folder." });
    const relative = file.path.slice(prefix.length);
    validateSkillPath({ filePath: relative });
    if (files.has(relative)) throw new SkillInputError({ message: `Duplicate skill file path: ${relative}` });
    const extension = path.posix.extname(relative).toLowerCase();
    const top = relative.split("/")[0];
    if (relative !== "SKILL.md" && relative !== "README.md" && relative !== "LICENSE" && !["references", "scripts", "assets"].includes(top!)) throw new SkillInputError({ message: `Unsupported skill file location: ${relative}` });
    if (relative !== "LICENSE" && !TEXT_EXTENSIONS.has(extension) && !(top === "assets" && ASSET_EXTENSIONS.has(extension))) throw new SkillInputError({ message: `Unsupported skill file type: ${relative}` });
    const bytes = decodeSkillBase64({ value: file.contentBase64 }, { maxBytes: MAX_SKILL_FILE_BYTES });
    if (relative === "SKILL.md" && bytes.length > 128 * 1024) throw new SkillInputError({ message: "SKILL.md exceeds 128 KiB." });
    total += bytes.length;
    if (total > MAX_SKILL_BYTES) throw new SkillInputError({ message: "Skill files exceed 8 MiB combined." });
    if (TEXT_EXTENSIONS.has(extension) || relative === "LICENSE") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new SkillInputError({ message: `Skill text file must be valid UTF-8 without null bytes: ${relative}` }); }
      if (bytes.includes(0)) throw new SkillInputError({ message: `Skill text file must be valid UTF-8 without null bytes: ${relative}` });
    } else {
      const valid = extension === ".png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : extension === ".webp" ? bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!valid) throw new SkillInputError({ message: `Skill asset content does not match its file type: ${relative}` });
    }
    files.set(relative, bytes);
  }
  return { ...validateSkillMarkdown({ markdown: files.get("SKILL.md")!.toString("utf8"), yamlReader }), files };
}
