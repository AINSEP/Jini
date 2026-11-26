import { expect, it, vi } from "vitest";
import { createYauzlAgentPluginArchiveReader, type YauzlEntry } from "../yauzl-archive-reader.js";

it.each([{ fileName: "link", mode: 0xa000 }, { fileName: "pipe/", mode: 0x1000 }])("refuses $fileName before yielding or policy counting", async ({ fileName, mode }) => {
  const effects: string[] = [];
  const entry: YauzlEntry = { fileName, versionMadeBy: 3 << 8, externalFileAttributes: mode << 16, uncompressedSize: 0 };
  const openReadStreamPromise = vi.fn();
  const reader = createYauzlAgentPluginArchiveReader({ yauzl: { fromBufferPromise: async () => ({
    eachEntry: async function* () { effects.push("read"); yield entry; }, openReadStreamPromise, close: () => { effects.push("close"); },
  }) } }, { rejectSpecialUnixEntry: () => { effects.push("refuse"); throw Object.assign(new Error("ZIP links and special entries are not allowed."), { code: "PLUGIN_PACKAGE_UNSAFE" }); } });
  const consume = async () => { for await (const _entry of reader.entries({ archive: new Uint8Array() })) effects.push("count"); };
  await expect(consume()).rejects.toMatchObject({ code: "PLUGIN_PACKAGE_UNSAFE", message: "ZIP links and special entries are not allowed." });
  expect(effects).toEqual(["read", "refuse", "close"]);
  expect(openReadStreamPromise).not.toHaveBeenCalled();
});
