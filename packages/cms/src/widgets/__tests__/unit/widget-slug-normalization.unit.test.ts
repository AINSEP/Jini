import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryEntryRepo } from "../../../entries/repo.memory.js";
import type { EntryRecord } from "../../../entries/types.js";
import { extractHtmlEntryRefs } from "../../entry-refs-extractor.js";
import { InMemoryEntryRefsRepo } from "../../entry-refs.memory.js";
import { toWhereUsedResponse } from "../../where-used.js";
import { normalizeWidgetSlugMarkers } from "../../widget-slug-normalization.js";

/**
 * @file B224 — a page that embeds a widget ONLY by slug must be visible to where-used/safe-delete.
 * The fix normalises slug -> id at write time; these tests run the write sequence a host performs
 * (normalise, persist, extract, replaceForSource) and then the where-used read safe-delete uses.
 */

const WS = "ws-1";
const PAGE = "page-1";
const WIDGET_ID = "11111111-1111-4111-8111-111111111111";

function widgetEntry(): EntryRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return { id: WIDGET_ID, workspaceId: WS, type: "widget", slug: "contact-form", status: "published", title: "Contact", bodyJson: null, fieldsJson: {}, publishedAt: now, createdAt: now, updatedAt: now, version: 1 };
}

async function savePage(html: string): Promise<{ stored: string; refsRepo: InMemoryEntryRefsRepo }> {
  const entryRepo = new InMemoryEntryRepo();
  await entryRepo.save(widgetEntry());
  const refsRepo = new InMemoryEntryRefsRepo();
  const stored = await normalizeWidgetSlugMarkers({ deps: { entryRepo }, input: { workspaceId: WS, html } });
  const refs = extractHtmlEntryRefs({ workspaceId: WS, sourceEntryId: PAGE, html: stored });
  await refsRepo.replaceForSource({ workspaceId: WS, sourceEntryId: PAGE, refs });
  return { stored, refsRepo };
}

const SLUG_ONLY = `<section><div class="cta" data-embed-config='{"type":"widget","slug":"contact-form"}'><p>fallback</p></div></section>`;

test("(a) saving a slug-only widget marker stores the widget id and produces an entry_refs row", async () => {
  const { stored, refsRepo } = await savePage(SLUG_ONLY);
  assert.equal(
    stored,
    `<section><div class="cta" data-embed-config='{"type":"widget","slug":"contact-form","id":"${WIDGET_ID}"}'><p>fallback</p></div></section>`,
  );
  const rows = await refsRepo.findBySource({ workspaceId: WS, sourceEntryId: PAGE });
  assert.deepEqual(rows.map((row) => [row.targetKind, row.targetId]), [["entry", WIDGET_ID]]);
});

test("(b) where-used for a widget referenced only by slug reports it as in use", async () => {
  const { refsRepo } = await savePage(SLUG_ONLY);
  const refs = await refsRepo.findByTarget({ workspaceId: WS, targetKind: "entry", targetId: WIDGET_ID });
  const whereUsed = toWhereUsedResponse({ refs });
  assert.equal(whereUsed.count, 1);
  assert.equal(whereUsed.references[0]?.sourceEntryId, PAGE);
});

test("an unknown slug leaves the marker untouched and does not throw", async () => {
  const html = `<div data-embed-config='{"type":"widget","slug":"no-such-widget"}'></div>`;
  const { stored, refsRepo } = await savePage(html);
  assert.equal(stored, html);
  assert.deepEqual(await refsRepo.findBySource({ workspaceId: WS, sourceEntryId: PAGE }), []);
});

test("an explicit id is authoritative and other marker types are untouched", async () => {
  const html =
    `<div data-embed-config='{"type":"widget","id":"other-id","slug":"contact-form"}'></div>` +
    `<div data-embed-config='{"type":"form","slug":"contact-form"}'></div>`;
  const { stored } = await savePage(html);
  assert.equal(stored, html);
});
