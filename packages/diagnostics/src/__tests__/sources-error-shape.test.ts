import { describe, expect, it } from "vitest";
import { collectLogSource } from "../sources.js";
import type { DiagnosticsFilesystemPort } from "../ports.js";

// A host port can reject with any value; normalization must preserve non-Error failures.
describe("collectLogSource error normalization", () => {
  it("stringifies a thrown non-Error value into the error field", async () => {
    const filesystem: DiagnosticsFilesystemPort = {
      readFile: async () => { throw "boom: a non-Error thrown value"; },
      readDirectory: async () => [],
      stat: async () => ({ isFile: true, mtimeMs: 0 }),
    };
    const collected = await collectLogSource({
      source: { name: "x.log", absolutePath: "/irrelevant/path.log", kind: "text" },
      filesystem,
    });
    expect(collected.content).toBeNull();
    expect(collected.bytes).toBe(0);
    expect(collected.error).toBe("boom: a non-Error thrown value");
  });
});
