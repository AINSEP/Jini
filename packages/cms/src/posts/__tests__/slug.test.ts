import assert from "node:assert/strict";
import { test } from "vitest";

import { derivePostSlugBase, isAutomaticPostSlug, MAX_SLUG_LENGTH, DERIVED_SLUG_SUFFIX_ROOM } from "../slug.js";

test("derivePostSlugBase leaves room for a collision suffix, trims a trailing dash, and falls back to untitled", () => {
  assert.equal(derivePostSlugBase({ title: "Hello World" }), "hello-world");
  const long = derivePostSlugBase({ title: "a".repeat(200) });
  assert.equal(long.length, MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM);
  assert.equal(derivePostSlugBase({ title: `${"b".repeat(MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM - 1)} tail` }), "b".repeat(MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM - 1));
  assert.equal(derivePostSlugBase({ title: "!!!" }), "untitled");
});

test("isAutomaticPostSlug recognises the derived slug, its numeric collision suffixes, and untitled placeholders", () => {
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world" }), true);
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world-2" }), true);
  assert.equal(isAutomaticPostSlug({ title: "Anything", slug: "untitled" }), true);
  assert.equal(isAutomaticPostSlug({ title: "Anything", slug: "untitled-7" }), true);
});

test("isAutomaticPostSlug treats an edited slug as manual, including a non-numeric suffix on the derived base", () => {
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "my-own-slug" }), false);
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world-draft" }), false);
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world-" }), false);
});
