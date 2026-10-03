import assert from "node:assert/strict";
import { test } from "vitest";
import { readSkillArchive, readSkillState, validateSkillMarkdown } from "../index.js";
import type { FilesystemPort, SkillFilesystemPort, SkillInstallDeps, YamlReaderPort } from "../ports.js";

test("the restored storage and YAML contracts match the existing installer modules", async () => {
  const unused = async (): Promise<never> => { throw new Error("unexpected mutation"); };
  const filesystem: FilesystemPort = { mkdir: unused, mkdtemp: unused, rename: unused, remove: unused, writeFile: unused,
    lstat: async () => ({ kind: "file", size: 36 }), readFile: async () => Buffer.from('{"enabled":false,"source":"uploaded"}') };
  const samePort: SkillFilesystemPort = filesystem;
  assert.deepEqual(await readSkillState({ directory: "/host/skill", stateFileName: ".host.json", filesystem: samePort }), { enabled: false, source: "uploaded" });
  const yamlReader: YamlReaderPort = { read: () => ({ name: "example", description: "Example." }) };
  assert.deepEqual(validateSkillMarkdown({ markdown: "---\nname: example\n---\n", yamlReader }), { name: "example", description: "Example." });
  const archiveReader: SkillInstallDeps["archiveReader"] = { open: async () => ({
    entries: (async function* () { yield { path: "SKILL.md", kind: "file" as const, size: 3, read: async function* () { yield Buffer.from("abc"); } }; })(), close: () => {},
  }) };
  assert.deepEqual(await readSkillArchive({ base64: "", archiveReader }), [{ path: "SKILL.md", contentBase64: "YWJj" }]);
});
