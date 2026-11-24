import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveThemeDirs } from "../theme-asset-dirs.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function makeRoot(folders: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "jini-theme-asset-dirs-"));
  roots.push(root);
  for (const folder of folders) mkdirSync(path.join(root, folder), { recursive: true });
  return root;
}

/** A plain join that refuses separators, standing in for the host's containment check. */
const resolvePathWithin = ({ root, segment }: { root: string; segment: string }) => (/[\\/]|^\.\.$/.test(segment) ? null : path.join(root, segment));
const HOST = { themeIdCandidates: ({ id }: { id: string }) => (id === "old" ? ["new", "old"] : [id]), resolvePathWithin };

test("hidden, catalog and empty ids are refused even when the folder exists", () => {
  const root = makeRoot(["__original-themes__", ".staging", "real"]);
  for (const themeId of ["", undefined, "__original-themes__", ".staging", "real/../real"]) {
    expect(resolveThemeDirs({ ...HOST, roots: [root], themeId }, {})).toEqual([]);
  }
});

test("candidates resolve in the injected order, first root wins per candidate", () => {
  const first = makeRoot(["new"]);
  const second = makeRoot(["new", "old"]);
  expect(resolveThemeDirs({ ...HOST, roots: [first, second], themeId: "old" }, {})).toEqual([path.join(first, "new"), path.join(second, "old")]);
});
