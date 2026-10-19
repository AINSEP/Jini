import { afterEach, expect, test, vi } from "vitest";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSkillFileReader } from "../../index.js";
import type { FilesystemPort } from "../../ports.js";

test("one reader bounds reads and inventory to a skill folder, including symlinks and text admission", async () => {
  const root = await filesystem.mkdtemp(path.join(tmpdir(), "jini-skill-reader-"));
  const skillRoot = path.join(root, "skill");
  await filesystem.mkdir(path.join(skillRoot, "references/nested"), { recursive: true });
  await filesystem.writeFile(path.join(skillRoot, "SKILL.md"), "# Skill\n");
  await filesystem.writeFile(path.join(skillRoot, "references/nested/check.mdx"), "Deep reference.\n");
  await filesystem.writeFile(path.join(skillRoot, "references/foundations.md"), "Exact foundations text.\n");
  await filesystem.writeFile(path.join(root, "outside.md"), "OUTSIDE_CANARY");
  await filesystem.symlink(path.join(root, "outside.md"), path.join(skillRoot, "escape.md"));
  await filesystem.symlink(path.join(root, "outside.md"), path.join(skillRoot, "references/nested/escape.md"));
  await filesystem.symlink(skillRoot, path.join(skillRoot, "cycle"));
  await filesystem.symlink(path.join(skillRoot, "references/foundations.md"), path.join(skillRoot, "alias.md"));
  const reader = createSkillFileReader({ skillRoot, filesystem });
  try {
    const files = ["alias.md", "references/foundations.md", "references/nested/check.mdx"];
    expect(await reader.read({})).toEqual({ text: "# Skill\n", files });
    expect(await reader.read({}, { file: "references/foundations.md" })).toEqual({ text: "Exact foundations text.\n", files });
    expect(await reader.read({}, { file: "alias.md" })).toEqual({ text: "Exact foundations text.\n", files });
    for (const file of ["../outside.md", "references/../SKILL.md", path.join(root, "outside.md"), "C:\\outside.md", "escape.md", "references/nested/escape.md", "missing.md"]) {
      const result = await reader.read({}, { file });
      expect(result.text).toBe("");
      expect(result.files).toEqual(files);
      expect(result.note).toContain("File request refused:");
      expect(result.note).toContain("Valid supporting files: alias.md, references/foundations.md, references/nested/check.mdx.");
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("OUTSIDE_CANARY");
    }
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});

test("extension allowlist, UTF-8, binary detection and exact 256 KiB size boundary govern reads AND inventory", async () => {
  const root = await filesystem.mkdtemp(path.join(tmpdir(), "jini-skill-text-"));
  const reader = createSkillFileReader({ skillRoot: root, filesystem });
  try {
    await filesystem.writeFile(path.join(root, "SKILL.md"), "# Skill");
    await filesystem.writeFile(path.join(root, "limit.txt"), "a".repeat(256 * 1024));
    await filesystem.writeFile(path.join(root, "too-large.md"), "a".repeat(256 * 1024 + 1));
    await filesystem.writeFile(path.join(root, "binary.md"), Buffer.from([0, 1, 2]));
    await filesystem.writeFile(path.join(root, "invalid.md"), Buffer.from([0xff]));
    await filesystem.writeFile(path.join(root, "image.png"), "DISALLOWED_CANARY");
    const extensions = ["md", "mdx", "txt", "json", "yaml", "yml", "ts", "tsx", "js", "jsx", "css", "html", "csv", "svg", "py", "sh"];
    for (const extension of extensions) await filesystem.writeFile(path.join(root, `sample.${extension}`), `Text for ${extension}.\n`);
    const files = ["limit.txt", ...extensions.map(extension => `sample.${extension}`)].sort();
    for (const extension of extensions) expect(await reader.read({}, { file: `sample.${extension}` })).toEqual({ text: `Text for ${extension}.\n`, files });
    expect((await reader.read({}, { file: "limit.txt" })).text).toBe("a".repeat(256 * 1024));
    for (const [file, reason] of [["too-large.md", "256 KiB"], ["binary.md", "binary content"], ["invalid.md", "invalid UTF-8"], ["image.png", "supported text extensions"]] as const) {
      const result = await reader.read({}, { file });
      expect(result.text).toBe("");
      expect(result.files).toEqual(files);
      expect(result.note).toContain(reason);
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("DISALLOWED_CANARY");
    }
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});

const temporaryRoots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of temporaryRoots.splice(0)) await filesystem.rm(root, { recursive: true, force: true }); });
async function skillFolder(files: Record<string, string> = { "SKILL.md": "# Skill" }): Promise<string> {
  const root = await filesystem.mkdtemp(path.join(tmpdir(), "jini-skill-bounds-"));
  temporaryRoots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await filesystem.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await filesystem.writeFile(path.join(root, file), content);
  }
  return root;
}

test("a directory requested by a text name is refused as not a regular file", async () => {
  const skillRoot = await skillFolder();
  await filesystem.mkdir(path.join(skillRoot, "folder.md"));
  const result = await createSkillFileReader({ skillRoot, filesystem }).read({}, { file: "folder.md" });
  expect(result.note).toBe("File request refused: only regular text files are readable. Valid supporting files: (none). Omit file to request SKILL.md.");
});

test("a file that grows past the cap after its size check is still refused", async () => {
  const skillRoot = await skillFolder({ "SKILL.md": "# Skill", "grows.md": "a".repeat(256 * 1024 + 1) });
  const smallStat = await filesystem.stat(path.join(skillRoot, "SKILL.md"));
  const growing: FilesystemPort = { ...filesystem, open: async (...args: Parameters<FilesystemPort["open"]>) => {
    const handle = await filesystem.open(...args);
    vi.spyOn(handle, "stat").mockResolvedValue(smallStat);
    return handle;
  } };
  const result = await createSkillFileReader({ skillRoot, filesystem: growing }).read({}, { file: "grows.md" });
  expect(result.note).toBe("File request refused: exceeds the 256 KiB text limit; no content returned. Valid supporting files: (none). Omit file to request SKILL.md.");
});

test("a native open failure is refused without reflecting the native message", async () => {
  const skillRoot = await skillFolder();
  const failing: FilesystemPort = { ...filesystem, open: async () => { throw new Error(`EIO: i/o error, open '${skillRoot}/SKILL.md'`); } };
  const result = await createSkillFileReader({ skillRoot, filesystem: failing }).read({});
  expect(result).toEqual({ text: "", files: [], note: "File request refused: file is missing or unreadable. Valid supporting files: (none). Omit file to request SKILL.md." });
});

test("a missing skill folder reports an incomplete inventory alongside the refusal", async () => {
  const skillRoot = path.join(await skillFolder(), "absent");
  const result = await createSkillFileReader({ skillRoot, filesystem }).read({});
  expect(result).toEqual({ text: "", files: [], note: "File request refused: file is missing, unreadable, or resolves outside this skill folder. Valid supporting files: (none). Omit file to request SKILL.md. Supporting-file inventory is incomplete: traversal limit reached or a directory is unreadable." });
});

test("an inventory deeper than 32 directories is marked incomplete", async () => {
  const deep = `${Array.from({ length: 33 }, (_, index) => `d${index}`).join("/")}/deep.md`;
  const skillRoot = await skillFolder({ "SKILL.md": "# Skill", "top.md": "top", [deep]: "deep" });
  const result = await createSkillFileReader({ skillRoot, filesystem }).read({});
  expect(result).toEqual({ text: "# Skill", files: ["top.md"], note: "Supporting-file inventory is incomplete: traversal limit reached or a directory is unreadable." });
});

test("the 4096-entry inventory budget stops at the boundary, including a directory reached with no budget left", async () => {
  const skillRoot = await skillFolder();
  // SKILL.md plus 4094 files leaves one entry: directory `g` spends it, so its walk and file `h` are cut off.
  await Promise.all(Array.from({ length: 4094 }, (_, index) => filesystem.writeFile(path.join(skillRoot, `f${String(index).padStart(4, "0")}`), "")));
  await filesystem.mkdir(path.join(skillRoot, "g"));
  await filesystem.writeFile(path.join(skillRoot, "g", "inside.md"), "inside");
  await filesystem.writeFile(path.join(skillRoot, "h.md"), "after");
  const result = await createSkillFileReader({ skillRoot, filesystem }).read({});
  expect(result).toEqual({ text: "# Skill", files: [], note: "Supporting-file inventory is incomplete: traversal limit reached or a directory is unreadable." });
}, 30_000);

test("the inventory lists files in code-unit order whatever the directory order", async () => {
  const skillRoot = await skillFolder({ "SKILL.md": "# Skill", "b.md": "b", "B.md": "B", "a.md": "a", "c/z.md": "z" });
  expect((await createSkillFileReader({ skillRoot, filesystem }).read({})).files).toEqual(["B.md", "a.md", "b.md", "c/z.md"]);
});

test("a text-named symlink to a contained non-text file is refused and not advertised", async () => {
  const skillRoot = await skillFolder({ "SKILL.md": "# Skill", "image.png": "DISALLOWED_CANARY" });
  await filesystem.symlink(path.join(skillRoot, "image.png"), path.join(skillRoot, "alias.md"));
  const result = await createSkillFileReader({ skillRoot, filesystem }).read({}, { file: "alias.md" });
  expect(result).toEqual({ text: "", files: [], note: "File request refused: file is missing, unreadable, or resolves outside this skill folder. Valid supporting files: (none). Omit file to request SKILL.md." });
});

test("a native read failure on an opened file is refused without reflecting the native message", async () => {
  const skillRoot = await skillFolder();
  const failing: FilesystemPort = { ...filesystem, open: async (...args: Parameters<FilesystemPort["open"]>) => {
    const handle = await filesystem.open(...args);
    vi.spyOn(handle, "read").mockRejectedValue(new Error(`EIO: i/o error, read '${skillRoot}/SKILL.md'`));
    return handle;
  } };
  const result = await createSkillFileReader({ skillRoot, filesystem: failing }).read({});
  expect(result).toEqual({ text: "", files: [], note: "File request refused: file is missing or unreadable. Valid supporting files: (none). Omit file to request SKILL.md." });
});
