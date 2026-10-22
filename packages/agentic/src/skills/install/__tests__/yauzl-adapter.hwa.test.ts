import { expect, test } from "vitest";
import { createYauzlSkillArchiveReader, readSkillArchive } from "../index.js";

function fixture(mode: number, content = "guidance", declaredSize = Buffer.byteLength(content)) {
  let reads = 0, closes = 0, destroys = 0;
  const reader = createYauzlSkillArchiveReader({ yauzl: {
    async fromBufferPromise(_bytes, options) {
      expect(options).toEqual({ lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
      return {
        eachEntry: async function* () { yield { fileName: "SKILL.md", uncompressedSize: declaredSize, externalFileAttributes: mode << 16 }; },
        async openReadStreamPromise() {
          reads++;
          return Object.assign((async function* () { yield Buffer.from(content); })(), { destroy: () => { destroys++; } });
        },
        close: () => { closes++; },
      };
    },
  } });
  return { reader, counts: () => ({ reads, closes, destroys }) };
}

test("the ZIP SDK adapter preserves strict names and closes successful streams and archives", async () => {
  const f = fixture(0o100644);
  expect(await readSkillArchive({ base64: "", archiveReader: f.reader })).toEqual([{ path: "SKILL.md", contentBase64: Buffer.from("guidance").toString("base64") }]);
  expect(f.counts()).toEqual({ reads: 1, closes: 1, destroys: 1 });
});

test.each([0o120777, 0o020666])("special file mode %i is rejected before its stream opens", async mode => {
  const f = fixture(mode);
  await expect(readSkillArchive({ base64: "", archiveReader: f.reader })).rejects.toThrow("Skill archives may contain only regular files and directories.");
  expect(f.counts()).toEqual({ reads: 0, closes: 1, destroys: 0 });
});

test("declared size mismatch releases the stream and ZIP handle on failure", async () => {
  const f = fixture(0o100644, "guidance", 1);
  await expect(readSkillArchive({ base64: "", archiveReader: f.reader })).rejects.toThrow("Skill archive file size does not match its metadata.");
  expect(f.counts()).toEqual({ reads: 1, closes: 1, destroys: 1 });
});

test("directory entries are classified by their trailing slash, whether or not the producer set a mode", async () => {
  const entries = [
    { fileName: "refs/", uncompressedSize: 0, externalFileAttributes: 0o040755 << 16 },
    { fileName: "dos-made/", uncompressedSize: 0, externalFileAttributes: 0 },
    { fileName: "dos-made/notes.md", uncompressedSize: 5, externalFileAttributes: 0 },
  ];
  const reader = createYauzlSkillArchiveReader({ yauzl: {
    async fromBufferPromise() {
      return {
        eachEntry: async function* () { yield* entries; },
        async openReadStreamPromise() { return Object.assign((async function* () { yield Buffer.from("notes"); })(), { destroy: () => {} }); },
        close: () => {},
      };
    },
  } });
  const opened = await reader.open({ bytes: new Uint8Array() });
  const kinds: Array<[string, string]> = [];
  for await (const entry of opened.entries) kinds.push([entry.path, entry.kind]);
  expect(kinds).toEqual([["refs/", "directory"], ["dos-made/", "directory"], ["dos-made/notes.md", "file"]]);
});
