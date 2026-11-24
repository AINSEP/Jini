import assert from "node:assert/strict";
import { test } from "vitest";

import type { GetEntryMetaDeps } from "../../seo.js";
import type { PageHeadContext } from "../../types.js";
import { createSeoPageHeadHook } from "../page-head-contributor.js";

/**
 * @file Characterization of the host-bound SEO `PageHeadHook`, written when it moved from the
 * host: its contributor priority, and the entry-less route that emits only site-level tags without
 * reading any entry, cover or title dependency. The entry and cover paths are covered by the
 * host's cover-image head tests, which run against this module.
 */

const ctx: PageHeadContext = { workspaceId: "ws-1", route: "/", canonicalUrl: "/", siteTitle: "Site" };
const deps = { renderBaseUrl: "https://example.test" } as unknown as GetEntryMetaDeps;
const neverTitle = async (): Promise<string | undefined> => { throw new Error("siteTitle must not be read without an entry"); };

test("the contributor priority defaults to 100 and honours an explicit one", () => {
  assert.equal(createSeoPageHeadHook({ deps, rootSlug: "home", siteTitle: neverTitle }).priority, 100);
  assert.equal(createSeoPageHeadHook({ deps, rootSlug: "home", siteTitle: neverTitle }, { priority: 7 }).priority, 7);
});

test("an entry-less route emits the title, canonical and absolute feed link only", async () => {
  const elements = await createSeoPageHeadHook({ deps, rootSlug: "home", siteTitle: neverTitle }).handle(ctx);
  assert.deepEqual(elements, [
    { kind: "title", text: "Site", priority: 100 },
    { kind: "link", rel: "canonical", href: "/", priority: 120 },
    { kind: "link", rel: "alternate", type: "application/rss+xml", title: "Site", href: "https://example.test/feed.xml", priority: 125 },
  ]);
});
