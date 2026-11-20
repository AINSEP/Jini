import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, test } from "vitest";
import { readThemeFileVersion, writeFileAtomically, type ThemeFileWritePorts } from "../atomic-write.node.js";
import type { ThemeFileAddress } from "../reviewed-write.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const root = mkdtempSync(join(tmpdir(), "theme-atomic-"));
  roots.push(root);
  const themeDir = join(root, "copy");
  mkdirSync(themeDir);
  writeFileSync(join(themeDir, "first.css"), "first-0");
  writeFileSync(join(themeDir, "second.css"), "second-0");
  const failures: unknown[] = [];
  const ports: ThemeFileWritePorts = {
    resolvePath: address => join(address.themeDir, address.relativePath),
    statPath: ({ target }, { stat = statSync } = {}) => stat(target, { throwIfNoEntry: false }),
    digest: ({ path }) => createHash("sha256").update(readFileSync(path)).digest("hex"),
    changedError: () => new Error("fixture changed file"),
    pathError: ({ reason, relativePath }) => new Error(`${reason}: ${relativePath ?? ""}`),
    reportPruneFailure: ({ error }) => { failures.push(error); },
  };
  const file: ThemeFileAddress = { themeDir, themesRoot: root, relativePath: "first.css" };
  return { root, themeDir, file, ports, failures, target: join(themeDir, file.relativePath) };
}

// Mutation: truncate/overwrite the destination instead of renaming a sibling temp inode.
test("replacement leaves an already open descriptor reading the complete old bytes", () => {
  const f = fixture();
  const descriptor = openSync(f.target, "r");
  try {
    assert.equal(writeFileAtomically({ ports: f.ports, target: f.target, relativePathForError: f.file.relativePath,
      fillTemp: temp => { assert.equal(join(f.themeDir, basename(temp)), temp); writeFileSync(temp, "new bytes"); } }), undefined);
    assert.equal(readFileSync(descriptor, "utf8"), "first-0");
    assert.equal(readFileSync(f.target, "utf8"), "new bytes");
    assert.deepEqual(readThemeFileVersion({ ...f.file, ports: f.ports }), {
      target: f.target, version: createHash("sha256").update("new bytes").digest("hex"),
    });
  } finally { closeSync(descriptor); }
});

// Mutation: omit temp cleanup when fillTemp writes and then throws.
test("a fill failure preserves the target, propagates by identity and removes its partial temp", () => {
  const f = fixture(), failure = new Error("fixture fill failed");
  assert.throws(() => writeFileAtomically({ ports: f.ports, target: f.target, relativePathForError: f.file.relativePath,
    fillTemp: temp => { writeFileSync(temp, "partial"); throw failure; } }), error => error === failure);
  assert.equal(readFileSync(f.target, "utf8"), "first-0");
  assert.deepEqual(readdirSync(f.themeDir).sort(), ["first.css", "second.css"]);
  assert.deepEqual(f.failures, []);
});

// Mutation: use the raw clock value instead of the monotonic maximum/exclusive sequence.
test("revision sequences increase across repeated and backward clock values", () => {
  const f = fixture(), revisions: string[] = [];
  for (const [index, now] of [1000, 1000, 900].entries()) {
    const revision = writeFileAtomically({ ports: f.ports, target: f.target, relativePathForError: f.file.relativePath,
      fillTemp: temp => writeFileSync(temp, `first-${index + 1}`) }, { revisionFile: f.file, options: { now: () => now } });
    assert.ok(revision);
    revisions.push(revision);
  }
  assert.deepEqual(revisions.map(path => basename(path)), ["1000", "1001", "1002"]);
  assert.deepEqual(revisions.map(path => readFileSync(join(path, "first.css"), "utf8")), ["first-0", "first-1", "first-2"]);
  assert.equal(readFileSync(f.target, "utf8"), "first-3");
  assert.deepEqual(f.failures, []);
});

// Mutations: retain 20 revisions globally, or include manual trash in replacement retention.
test("retention keeps the latest 20 per file and leaves manual trash untouched", () => {
  const f = fixture();
  const manual = join(f.themeDir, ".trash", "1", "first.css");
  mkdirSync(join(f.themeDir, ".trash", "1"), { recursive: true });
  writeFileSync(manual, "manually removed");
  for (const name of ["first", "second"]) {
    const file = { ...f.file, relativePath: `${name}.css` };
    for (let index = 1; index <= 25; index++) {
      writeFileAtomically({ ports: f.ports, target: join(f.themeDir, file.relativePath), relativePathForError: file.relativePath,
        fillTemp: temp => writeFileSync(temp, `${name}-${index}`) }, { revisionFile: file, options: { now: () => 100 } });
    }
  }
  const revisionRoot = join(f.themeDir, ".trash", "revisions");
  const directories = readdirSync(revisionRoot).sort((a, b) => Number(a) - Number(b));
  for (const name of ["first", "second"]) {
    const retained = directories.map(directory => join(revisionRoot, directory, `${name}.css`)).filter(path => existsSync(path));
    assert.equal(retained.length, 20);
    assert.deepEqual(retained.map(path => readFileSync(path, "utf8")), Array.from({ length: 20 }, (_, i) => `${name}-${i + 5}`));
    assert.equal(readFileSync(join(f.themeDir, `${name}.css`), "utf8"), `${name}-25`);
  }
  assert.equal(readFileSync(manual, "utf8"), "manually removed");
  assert.deepEqual(f.failures, []);
});
