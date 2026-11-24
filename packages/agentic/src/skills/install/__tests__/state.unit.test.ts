import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createNodeSkillFilesystem } from "../node-filesystem.js";
import { readSkillState as read, SKILL_STATE_FILE_NAME as SKILL_STATE_FILE } from "../state.js";

// Direct tests for the install record reader (moved from the host app with the reader): legacy folders default to enabled, and every
// malformed record fails closed (throws) instead of silently enabling the skill.
async function withDir(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "skill-state-"));
  try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const write = (dir: string, value: unknown) => writeFile(path.join(dir, SKILL_STATE_FILE), typeof value === "string" ? value : JSON.stringify(value));
const INVALID = { message: "Invalid skill installation record." };
const filesystem = createNodeSkillFilesystem({});
const readSkillState = ({ directory }: { directory: string }) => read({ directory, stateFileName: SKILL_STATE_FILE, filesystem });

test("a folder without a record (legacy install) or a missing folder reads as enabled and uploaded", () => withDir(async dir => {
  assert.deepEqual(await readSkillState({ directory: dir }), { enabled: true, source: "uploaded" });
  assert.deepEqual(await readSkillState({ directory: path.join(dir, "missing") }), { enabled: true, source: "uploaded" });
}));

test("valid uploaded and GitHub records are returned as written", () => withDir(async dir => {
  await write(dir, { enabled: false, source: "uploaded" });
  assert.deepEqual(await readSkillState({ directory: dir }), { enabled: false, source: "uploaded" });
  const source = { githubUrl: "https://github.com/acme/skills", commit: "0123456789abcdef0123456789abcdef01234567" };
  await write(dir, { enabled: true, source });
  assert.deepEqual(await readSkillState({ directory: dir }), { enabled: true, source });
}));

test("malformed records fail closed", () => withDir(async dir => {
  for (const record of [
    { enabled: "yes", source: "uploaded" },
    { source: "uploaded" },
    { enabled: true },
    { enabled: true, source: null },
    { enabled: true, source: "github" },
    { enabled: true, source: { githubUrl: 5, commit: "a".repeat(40) } },
    { enabled: true, source: { githubUrl: "https://github.com/a/b", commit: "A".repeat(40) } },
    { enabled: true, source: { githubUrl: "https://github.com/a/b" } },
  ]) {
    await write(dir, record);
    await assert.rejects(readSkillState({ directory: dir }), INVALID, JSON.stringify(record));
  }
  await write(dir, "{not json");
  await assert.rejects(readSkillState({ directory: dir }), SyntaxError);
}));

test("oversized records, directories and symlinks in the record's place fail closed", () => withDir(async dir => {
  await write(dir, JSON.stringify({ enabled: true, source: "uploaded" }).padEnd(8193, " "));
  await assert.rejects(readSkillState({ directory: dir }), INVALID);
  await write(dir, JSON.stringify({ enabled: true, source: "uploaded" }).padEnd(8192, " "));
  assert.deepEqual(await readSkillState({ directory: dir }), { enabled: true, source: "uploaded" });

  const asDirectory = path.join(dir, "a");
  await mkdir(path.join(asDirectory, SKILL_STATE_FILE), { recursive: true });
  await assert.rejects(readSkillState({ directory: asDirectory }), INVALID);

  const linked = path.join(dir, "b");
  await mkdir(linked);
  await symlink(path.join(dir, SKILL_STATE_FILE), path.join(linked, SKILL_STATE_FILE));
  await assert.rejects(readSkillState({ directory: linked }), INVALID);
  // A dangling link is not "absent": it must not fall back to enabled.
  const dangling = path.join(dir, "c");
  await mkdir(dangling);
  await symlink(path.join(dir, "nowhere.json"), path.join(dangling, SKILL_STATE_FILE));
  await assert.rejects(readSkillState({ directory: dangling }), INVALID);
}));
