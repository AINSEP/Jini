import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDirectoryTarget } from "../resolve-directory-target.js";

// Real links in a private fixture; no dependency on the machine's /var aliases.
describe("resolveDirectoryTarget", () => {
it("ordinary existing and missing targets collapse dot segments without resolving ancestor links", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dir-target-"));
  try {
    fs.mkdirSync(path.join(root, "real"));
    fs.mkdirSync(path.join(root, "real", "existing"));
    fs.symlinkSync("real", path.join(root, "alias"), "dir");
    expect(resolveDirectoryTarget({ dirArg: path.join(root, "alias", "existing") })).toBe(path.join(root, "alias", "existing"));
    expect(resolveDirectoryTarget({ dirArg: `${root}/alias/../missing` })).toBe(path.join(root, "missing"));
    fs.writeFileSync(path.join(root, "file"), "fixture");
    expect(resolveDirectoryTarget({ dirArg: path.join(root, "file") })).toBe(path.join(root, "file"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("existing target links resolve nested links, while dangling links resolve relative and absolute destinations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dir-target-links-"));
  try {
    fs.mkdirSync(path.join(root, "real"));
    fs.symlinkSync("real", path.join(root, "inner"), "dir");
    fs.symlinkSync("inner", path.join(root, "outer"), "dir");
    expect(resolveDirectoryTarget({ dirArg: path.join(root, "outer") })).toBe(fs.realpathSync(root) + "/real");
    fs.mkdirSync(path.join(root, "links"));
    fs.symlinkSync("../future", path.join(root, "links", "relative"), "dir");
    fs.symlinkSync(path.join(root, "absolute-future"), path.join(root, "links", "absolute"), "dir");
    expect(resolveDirectoryTarget({ dirArg: path.join(root, "links", "relative") })).toBe(path.join(root, "future"));
    expect(resolveDirectoryTarget({ dirArg: path.join(root, "links", "absolute") })).toBe(path.join(root, "absolute-future"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
});
