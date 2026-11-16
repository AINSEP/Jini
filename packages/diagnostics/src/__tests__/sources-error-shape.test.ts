import { describe, expect, it } from "vitest";
import { collectLogSource } from "../sources.js";
import type { DiagnosticsFilesystemPort } from "../ports.js";

// A host port can reject with any value; a non-Error failure is reported by its type only, so a thrown
// string (which may carry a secret or a path) never reaches the exported bundle.
describe("collectLogSource error normalization", () => {
  it("reports a thrown non-Error value by its type in the error field", async () => {
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
    expect(collected.error).toBe("string");
  });
});
