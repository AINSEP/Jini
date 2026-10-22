import { expect, test } from "vitest";
import { readSkillArchive, readSkillState, validateSkillMarkdown } from "../index.js";
import type { ArchiveReaderPort, FilesystemPort, SkillInstallDeps, YamlReaderPort } from "../ports.js";

test("the archive contract rejects special entries before any content is read and closes the reader", async () => {
  let reads = 0;
  let closes = 0;
  const archiveReader: ArchiveReaderPort = { async open() { return {
    entries: (async function* () {
      yield { path: "SKILL.md", kind: "other" as const, size: 1,
        read: async function* () { reads++; yield Buffer.from("x"); } };
    })(),
    close() { closes++; },
  }; } };
  await expect(readSkillArchive({ base64: "", archiveReader })).rejects.toThrow(/regular files/);
  expect(reads).toBe(0);
  expect(closes).toBe(1);
});

test("state and validation consume the same filesystem and YAML port vocabulary as installation", async () => {
  const mutation = async (): Promise<never> => { throw new Error("unexpected mutation"); };
  const filesystem: FilesystemPort = {
    mkdir: mutation, mkdtemp: mutation, writeFile: mutation, rename: mutation, remove: mutation,
    async lstat({ path }) { expect(path).toBe("/host/example/.state.json"); return { kind: "file", size: 36 }; },
    async readFile({ maxBytes }) { expect(maxBytes).toBe(8192); return Buffer.from('{"enabled":false,"source":"uploaded"}'); },
  };
  const yamlReader: YamlReaderPort = { read: () => ({ name: "example", description: "Example skill" }) };
  const effects: Pick<SkillInstallDeps, "filesystem" | "yamlReader"> = { filesystem, yamlReader };
  expect(await readSkillState({ directory: "/host/example", stateFileName: ".state.json", filesystem: effects.filesystem }))
    .toEqual({ enabled: false, source: "uploaded" });
  expect(validateSkillMarkdown({ markdown: "---\nname: example\n---\n", yamlReader: effects.yamlReader }))
    .toEqual({ name: "example", description: "Example skill" });
});
