import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { resolvePathWithin } from "../strict-containment.js";

test("resolvePathWithin: refuses a traversal segment that resolves outside an absolute root, but accepts a benign one under the same root", () => {
  const root = path.join(path.sep, "fixture-export-test-containment");
  assert.equal(resolvePathWithin({ root: root, segment:  "../../../etc/passwd" }), null);
  assert.equal(resolvePathWithin({ root: root, segment:  "theme-assets/basic/css/base.css" }), path.join(root, "theme-assets/basic/css/base.css"));
});

test("resolvePathWithin: refuses when root is not itself absolute, even for an otherwise-benign segment", () => {

  assert.equal(resolvePathWithin({ root: "relative-fixture-export-output", segment:  "theme-assets/basic/css/base.css" }), null);
});

test("resolvePathWithin: accepts a benign segment under an absolute root that carries a trailing separator", () => {

  const root = path.join(path.sep, "fixture-export-test-containment") + path.sep;
  assert.equal(
    resolvePathWithin({ root: root, segment:  "theme-assets/basic/css/base.css" }),
    path.join(path.sep, "fixture-export-test-containment", "theme-assets/basic/css/base.css"),
  );
});

test("resolvePathWithin: root '/' accepts a benign child instead of refusing everything", () => {

  assert.equal(resolvePathWithin({ root: path.sep, segment:  "theme-assets/basic.css" }), path.join(path.sep, "theme-assets/basic.css"));
});

test("resolvePathWithin: still refuses a traversal payload under a trailing-separator root", () => {

  const root = path.join(path.sep, "fixture-export-test-containment") + path.sep;
  assert.equal(resolvePathWithin({ root: root, segment:  "../../../etc/passwd" }), null);
});

test("resolvePathWithin: refuses a sibling whose name shares the root prefix", () => {
  const root = path.join(path.sep, "a", "export");
  assert.equal(resolvePathWithin({ root: root, segment:  "../export-evil/x" }), null);
  assert.equal(resolvePathWithin({ root: root + path.sep, segment:  "../export-evil/x" }), null);
  assert.equal(resolvePathWithin({ root: root, segment:  "x" }), path.join(root, "x"));
});

test("resolvePathWithin: refuses absolute segments and paths resolving to the root itself", () => {
  const root = path.join(path.sep, "a", "export");
  for (const segment of [path.join(root, "x"), path.join(path.sep, "etc", "passwd"), "..", ".", "child/..", ""]) {
    assert.equal(resolvePathWithin({ root: root, segment:  segment }), null, segment);
  }
});
