import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveAvailableFormSlug, slugifyFormName, FORM_SLUG_MAX_LENGTH } from "./support/host-ports.fixture.js";
import { SLUG_PATTERN } from "../index.js";

/**
 * @file Certifies the slug derivation `content_duplicate`'s `"form"` resource needs and Forms did
 * not already have.
 *
 * Posts get this for free — `createPost` derives and disambiguates a slug itself when the caller
 * omits one. `createFormDefinition` does not: it REQUIRES an explicit slug and rejects anything
 * outside `^[a-z0-9][a-z0-9-]{0,63}$` (plus the reserved `new`). So duplicating a form has to
 * produce a valid, free slug before it calls create, or every copy of "Contact Us" would collide
 * with the last one. Every case here asserts against `write-service.ts`'s OWN exported
 * `SLUG_PATTERN`, so a change to that pattern breaks these tests rather than silently outdating them.
 */

function takenSet(...slugs: string[]) {
  const taken = new Set(slugs);
  return async (slug: string) => taken.has(slug);
}

const NEVER_TAKEN = async () => false;

test("slugifyFormName lowercases, collapses non-alphanumerics to single hyphens, and trims them from the ends", () => {
  assert.equal(slugifyFormName("Contact Us"), "contact-us");
  assert.equal(slugifyFormName("Copy of Contact Us"), "copy-of-contact-us");
  assert.equal(slugifyFormName("  Newsletter — Signup!!  "), "newsletter-signup");
  // Non-ASCII letters transliterate (`platform/html/slug.ts`, 2026-09-28); they used to become
  // separators, which gave "j-vou-2026".
  assert.equal(slugifyFormName("Já_Vou (2026)"), "ja-vou-2026");
});

test("slugifyFormName truncates to the pattern's own 64-character ceiling without leaving a trailing hyphen", () => {
  const slug = slugifyFormName(`${"a".repeat(60)} bbbbbbbbbb`);
  assert.equal(slug.length, FORM_SLUG_MAX_LENGTH);
  assert.doesNotMatch(slug, /-$/);
  assert.match(slug, SLUG_PATTERN);
});

test("a name with nothing sluggable falls back to a valid slug rather than an empty string", async () => {
  assert.equal(slugifyFormName("!!! ---"), "");
  assert.match(await deriveAvailableFormSlug({ name: "!!! ---" }, { isTaken: NEVER_TAKEN }), SLUG_PATTERN);
});

test("a free derived slug is used as-is", async () => {
  assert.equal(await deriveAvailableFormSlug({ name: "Copy of Contact Us" }, { isTaken: NEVER_TAKEN }), "copy-of-contact-us");
});

test("a taken slug is disambiguated with an incrementing suffix, skipping every taken one", async () => {
  const isTaken = takenSet("copy-of-contact-us", "copy-of-contact-us-2", "copy-of-contact-us-3");
  assert.equal(await deriveAvailableFormSlug({ name: "Copy of Contact Us" }, { isTaken }), "copy-of-contact-us-4");
});

test("the reserved slug 'new' is never produced — it would make the form unreachable at its own admin URL", async () => {
  const slug = await deriveAvailableFormSlug({ name: "New" }, { isTaken: NEVER_TAKEN });
  assert.notEqual(slug, "new");
  assert.match(slug, SLUG_PATTERN);
});

test("a suffix never pushes the slug past the 64-character ceiling", async () => {
  const longName = "a".repeat(FORM_SLUG_MAX_LENGTH);
  const base = slugifyFormName(longName);
  const slug = await deriveAvailableFormSlug({ name: longName }, { isTaken: takenSet(base) });

  assert.ok(slug.length <= FORM_SLUG_MAX_LENGTH, `expected <= ${FORM_SLUG_MAX_LENGTH} characters, got ${slug.length}`);
  assert.notEqual(slug, base);
  assert.match(slug, SLUG_PATTERN);
});

test("every derived slug this function can return satisfies write-service's own SLUG_PATTERN", async () => {
  for (const name of ["Contact Us", "!!!", "New", "a".repeat(200), "Über Größe", "9 Lives", "-leading-hyphen"]) {
    const slug = await deriveAvailableFormSlug({ name }, { isTaken: NEVER_TAKEN });
    assert.match(slug, SLUG_PATTERN, `'${name}' derived an invalid slug '${slug}'`);
  }
});

test("the search gives up rather than looping forever when every candidate is taken", async () => {
  await assert.rejects(
    deriveAvailableFormSlug({ name: "Contact Us" }, { isTaken: async () => true }),
    /no free slug/i,
  );
});
