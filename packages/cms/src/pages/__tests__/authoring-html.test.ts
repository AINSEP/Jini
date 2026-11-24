import assert from "node:assert/strict";
import { ToolInputError } from "@jini-ai/core";
import { test } from "vitest";

import { requirePageAuthoringHtml } from "../authoring-html.js";

/**
 * @file Characterization of the page-authoring guard: a `{{media:slug}}` token only resolves inside
 * Media widget HTML, so page HTML carrying a bare one would persist a broken photo.
 */

test("clean page HTML is returned unchanged", () => {
  const html = `<section><img src="/media/pastry.jpg" alt="Pastry"><p>{{ not a media token }}</p></section>`;
  assert.equal(requirePageAuthoringHtml({ html }), html);
});

test("a bare media token in text is refused with the media-embed alternative", () => {
  assert.throws(
    () => requirePageAuthoringHtml({ html: `<p>{{media:pastry-counter-3}}</p>` }),
    (error: unknown) => error instanceof ToolInputError && /Media widget HTML mode only/.test(error.message) && /data-embed-config/.test(error.message),
  );
});

test("a bare media token in an ordinary attribute is refused", () => {
  assert.throws(() => requirePageAuthoringHtml({ html: `<img src="{{ media:hero }}">` }), ToolInputError);
});

test("a media token inside data-embed-config is left to the embed resolver", () => {
  const html = `<div data-embed-config='{"type":"media","html":"{{media:hero}}"}'></div>`;
  assert.equal(requirePageAuthoringHtml({ html }), html);
});

test("a bare media token inside a <template> is still refused", () => {
  assert.throws(() => requirePageAuthoringHtml({ html: `<template><p>{{media:hero}}</p></template>` }), ToolInputError);
});
