/** @file `isSupervisedSiteUrl`: only a parseable url on a supervised site's exact origin passes. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { isSupervisedSiteUrl } from "../supervised-site-url.js";

const sites = [{ server: { origin: "http://127.0.0.1:4100" } }, { server: { origin: "http://127.0.0.1:4200/" } }];

test("a url on any supervised site's origin is supervised, whatever its path", () => {
  assert.equal(isSupervisedSiteUrl({ raw: "http://127.0.0.1:4100/admin/posts?x=1", sites }), true);
  assert.equal(isSupervisedSiteUrl({ raw: "http://127.0.0.1:4200", sites }), true);
});

test("another port, scheme or host is not, and neither is anything with no sites open", () => {
  assert.equal(isSupervisedSiteUrl({ raw: "http://127.0.0.1:4300/", sites }), false);
  assert.equal(isSupervisedSiteUrl({ raw: "https://127.0.0.1:4100/", sites }), false);
  assert.equal(isSupervisedSiteUrl({ raw: "http://localhost:4100/", sites }), false);
  assert.equal(isSupervisedSiteUrl({ raw: "http://127.0.0.1:4100/", sites: [] }), false);
});

test("an unparseable url is never supervised", () => {
  assert.equal(isSupervisedSiteUrl({ raw: "not a url", sites }), false);
  assert.equal(isSupervisedSiteUrl({ raw: "", sites }), false);
});
