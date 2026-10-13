import { expect, test } from "vitest";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSkillFileReader } from "../../index.js";

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
