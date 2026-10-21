import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeDiagnosticsPorts } from "../node-ports.js";

describe("createNodeDiagnosticsPorts filesystem.readFile", () => {
  let root = "";
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostics-node-ports-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("refuses to read a directory as a diagnostic source", async () => {
    const { filesystem } = createNodeDiagnosticsPorts({});
    await expect(filesystem.readFile({ absolutePath: root })).rejects.toThrow("Diagnostic source is not a regular file");
  });

  it("reads a regular file whole, or only its bounded tail", async () => {
    const file = path.join(root, "daemon.log");
    fs.writeFileSync(file, "first line\nlast line\n");
    const { filesystem } = createNodeDiagnosticsPorts({});
    expect((await filesystem.readFile({ absolutePath: file })).toString()).toBe("first line\nlast line\n");
    expect((await filesystem.readFile({ absolutePath: file }, { tailBytes: 10 })).toString()).toBe("last line\n");
  });
});
