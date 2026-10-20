/** Bounded skill-bundle validation; scripts are stored as data and never executed. */
import path from "node:path";
import type { YamlReaderPort } from "./ports.js";

export type SkillYamlPort = YamlReaderPort;
export class SkillInputError extends Error {
  constructor(required: { message: string }, optional?: { cause?: unknown });
  /** Published host adapters may still use the native Error call shape during migration. */
  constructor(message: string, optional?: { cause?: unknown });
  constructor(required: { message: string } | string, optional: { cause?: unknown } = {}) {
    super(typeof required === "string" ? required : required.message, optional);
  }
}
export interface SkillUploadFile { readonly path: string; readonly contentBase64: string }
export const MAX_SKILL_BYTES = 8 * 1024 * 1024;
export const MAX_SKILL_FILES = 256;
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".svg", ".sh", ".py", ".js", ".ts", ".mjs"]);
const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ROOT_FILES = new Set(["SKILL.md", "README.md", "LICENSE"]);
const SKILL_FOLDERS = new Set(["references", "scripts", "assets"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MISSING_FRONTMATTER = "SKILL.md must have YAML frontmatter with a name and description.";

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
  const { name, description } = readFrontmatterFields({ markdown, yamlReader });
  if (typeof name !== "string" || typeof description !== "string" || !description.trim()) throw new SkillInputError({ message: MISSING_FRONTMATTER });
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new SkillInputError({ message: "Skill name must use lowercase letters, digits and single hyphens (1–64 characters)." });
  if (description.length > 1024) throw new SkillInputError({ message: "Skill description exceeds 1024 characters." });
  return { name, description: description.replace(/\s+/g, " ").trim() };
}

/** Parses the leading `---` block through the host YAML port; a non-object result has no fields. */
function readFrontmatterFields({ markdown, yamlReader }: { markdown: string; yamlReader: YamlReaderPort }): Record<string, unknown> {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new SkillInputError({ message: MISSING_FRONTMATTER });
  let fields: unknown;
  try { fields = yamlReader.read({ yaml: frontmatter[1]! }); }
  catch (error) { throw new SkillInputError({ message: "SKILL.md must have valid YAML frontmatter." }, { cause: error }); }
  return (fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>;
}

/** Validates the whole package before writes, including cross-file collisions and combined limits.
 * @complexity O(total bytes + files × path length), bounded to 8 MiB / 256 files.
 */
export function validateSkillFiles({ files: upload, yamlReader }: { files: readonly SkillUploadFile[]; yamlReader: YamlReaderPort }, _optional: Record<string, never> = {}) {
  if (!Array.isArray(upload) || upload.length === 0 || upload.length > MAX_SKILL_FILES) throw new SkillInputError({ message: "A skill must contain 1–256 files." });
  for (const file of upload) validateSkillPath({ filePath: file.path });
  const prefix = selectSkillFolder({ upload });
  const files = new Map<string, Buffer>();
  const budget = { total: 0 };
  for (const file of upload) {
    const { relative, bytes } = validateBundleFile({ file, prefix, seen: files, budget });
    files.set(relative, bytes);
  }
  return { ...validateSkillMarkdown({ markdown: files.get("SKILL.md")!.toString("utf8"), yamlReader }), files };
}

/** The folder holding the bundle's only SKILL.md (empty string at the root). */
function selectSkillFolder({ upload }: { upload: readonly SkillUploadFile[] }): string {
  const skillFiles = upload.filter(f => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"));
  if (skillFiles.length !== 1) {
    if (skillFiles.length > 1 && new Set(skillFiles.map(f => f.path)).size === 1) throw new SkillInputError({ message: `Duplicate skill file path: ${skillFiles[0]!.path}` });
    throw new SkillInputError({ message: "Choose one skill folder containing a single SKILL.md." });
  }
  return skillFiles[0]!.path.slice(0, -"SKILL.md".length);
}

/** Checks one upload's folder, path, location, type, sizes and content; returns its folder-relative key. */
function validateBundleFile({ file, prefix, seen, budget }: { file: SkillUploadFile; prefix: string; seen: ReadonlyMap<string, Buffer>; budget: { total: number } }): { relative: string; bytes: Buffer } {
  if (!file.path.startsWith(prefix)) throw new SkillInputError({ message: "All files must belong to the selected skill folder." });
  const relative = file.path.slice(prefix.length);
  validateSkillPath({ filePath: relative });
  if (seen.has(relative)) throw new SkillInputError({ message: `Duplicate skill file path: ${relative}` });
  const { extension, isText } = classifySkillFile({ relative });
  const bytes = decodeSkillBase64({ value: file.contentBase64 }, { maxBytes: MAX_SKILL_FILE_BYTES });
  if (relative === "SKILL.md" && bytes.length > 128 * 1024) throw new SkillInputError({ message: "SKILL.md exceeds 128 KiB." });
  budget.total += bytes.length;
  if (budget.total > MAX_SKILL_BYTES) throw new SkillInputError({ message: "Skill files exceed 8 MiB combined." });
  if (isText) assertTextContent({ relative, bytes });
  else if (!matchesAssetSignature({ extension, bytes })) throw new SkillInputError({ message: `Skill asset content does not match its file type: ${relative}` });
  return { relative, bytes };
}

/** Allowed locations are SKILL.md, README.md, LICENSE and the references/scripts/assets folders;
 * text extensions anywhere there, image extensions only under assets/. */
function classifySkillFile({ relative }: { relative: string }): { extension: string; isText: boolean } {
  const extension = path.posix.extname(relative).toLowerCase();
  const top = relative.split("/")[0]!;
  if (!ROOT_FILES.has(relative) && !SKILL_FOLDERS.has(top)) throw new SkillInputError({ message: `Unsupported skill file location: ${relative}` });
  const isText = relative === "LICENSE" || TEXT_EXTENSIONS.has(extension);
  if (!isText && !(top === "assets" && ASSET_EXTENSIONS.has(extension))) throw new SkillInputError({ message: `Unsupported skill file type: ${relative}` });
  return { extension, isText };
}

/** Text files must be strict UTF-8 with no NUL bytes. */
function assertTextContent({ relative, bytes }: { relative: string; bytes: Buffer }): void {
  const message = `Skill text file must be valid UTF-8 without null bytes: ${relative}`;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) { throw new SkillInputError({ message }, { cause: error }); }
  if (bytes.includes(0)) throw new SkillInputError({ message });
}

/** Magic-byte sniffing for the allowed image types (.png, .webp, otherwise JPEG). */
function matchesAssetSignature({ extension, bytes }: { extension: string; bytes: Buffer }): boolean {
  if (extension === ".png") return bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  if (extension === ".webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
