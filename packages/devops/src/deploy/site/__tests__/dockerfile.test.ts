import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { readDockerfileSource, writeDockerfileSource, writeDockerfileSourceWithIfMatch } from "../dockerfile.js";

function withTempProject(check: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "jini-dockerfile-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
  try {
    check(join(dir, "Dockerfile"));
  } finally {
    cwd.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an empty file has a strong validator, distinct from the missing file", () => {
  withTempProject(file => {
    expect(readDockerfileSource()).toEqual({ exists: false, contents: null, etag: 'W/"missing"' });
    const empty = { exists: true, contents: "", etag: '"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"' };
    expect(writeDockerfileSourceWithIfMatch({ contents: "", ifMatch: 'W/"missing"' }))
      .toEqual({ ok: true, snapshot: empty });
    expect(readFileSync(file, "utf8")).toBe("");
    expect(readDockerfileSource()).toEqual(empty);
  });
});

test("a stale editor receives the live file without replacing it and can retry with the current validator", () => {
  withTempProject(file => {
    const original = writeDockerfileSource({ contents: "FROM scratch\n" });
    writeFileSync(file, "FROM node:22\n", "utf8");
    const current = readDockerfileSource();
    expect(current.contents).toBe("FROM node:22\n");
    expect(current.etag).not.toBe(original.etag);
    const replacement = "FROM node:22\n# café\n";
    expect(writeDockerfileSourceWithIfMatch({ contents: replacement, ifMatch: original.etag }))
      .toEqual({ ok: false, reason: "conflict", current });
    expect(readFileSync(file, "utf8")).toBe("FROM node:22\n");
    const result = writeDockerfileSourceWithIfMatch({ contents: replacement, ifMatch: current.etag });
    expect(result).toMatchObject({ ok: true, snapshot: { exists: true, contents: replacement } });
    expect(readFileSync(file, "utf8")).toBe(replacement);
    expect(result).toEqual({ ok: true, snapshot: readDockerfileSource() });
    expect(readDockerfileSource().etag).not.toBe(current.etag);
  });
});
