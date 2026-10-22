import { expect, test } from "vitest";
import { buildPackageFileTree } from "../package-file-tree.js";

test("the host locale changes ordering at every depth while the package default remains stable", () => {
  const paths = ["ä.md", "z.md", "nested/ä.md", "nested/z.md", "nested/file10.md", "nested/file2.md"];
  const baseline = buildPackageFileTree({ paths });
  const treatment = buildPackageFileTree({ paths }, { locale: "sv" });
  expect(baseline.map(node => node.name)).toEqual(["ä.md", "z.md", "nested"]);
  expect(treatment.map(node => node.name)).toEqual(["z.md", "ä.md", "nested"]);
  const nested = treatment[2]!;
  expect(nested.kind).toBe("folder");
  if (nested.kind === "folder") expect(nested.children.map(node => node.name)).toEqual(["file2.md", "file10.md", "z.md", "ä.md"]);
});
