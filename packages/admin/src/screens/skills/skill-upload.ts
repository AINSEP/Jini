import type { SkillInstallPayload } from "@jini-ai/core/contracts/site/skill-install";
const MAX_BYTES = 8 * 1024 * 1024;

async function base64(file: File) {
  const buffer = await file.arrayBuffer().catch(cause => { throw new Error("Could not read skill files.", { cause }); });
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}

/** The picker and chat drops use identical byte encoding and preserve folder-relative paths. */
export async function prepareSkillUpload({ files }: { files: readonly File[] }, { paths }: { paths?: readonly string[] } = {}): Promise<SkillInstallPayload> {
  if (!files.length || files.length > 256 || files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) throw new Error("Choose up to 256 files, 8 MiB total.");
  const firstFile = files[0];
  if (!firstFile) throw new Error("Skill upload has no first file.");
  if (files.length === 1 && firstFile.name.toLowerCase().endsWith(".zip")) return { archiveBase64: await base64(firstFile) };
  if (!files.some(f => f.name === "SKILL.md")) throw new Error("Choose a skill folder, ZIP, or SKILL.md.");
  return { files: await Promise.all(files.map(async (file, index) => ({ path: paths?.[index] ?? ((file as File & { relativePath?: string }).relativePath || file.webkitRelativePath || file.name), contentBase64: await base64(file) }))) };
}
