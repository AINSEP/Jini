import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import { LISTING_SEE_MORE_SCRIPT, renderListingBatchDocument, renderListingMore, wrapListingItems } from '../index.js';

// Untyped, as in consent/__tests__/html.test.ts: this package carries no @types/jsdom.
const { JSDOM } = createRequire(import.meta.url)('jsdom');

/**
 * Runs the inline see-more script in its own JSDOM window (no global DOM, per vitest.config.ts):
 * reveal, "Loading…" + disabled in flight, append + swap the batch URL, remove after the last batch,
 * re-enable on failure.
 */

function page(batches: Record<string, string | Error>) {
  const dom = new JSDOM(
    `<ul data-jini-listing="1">${wrapListingItems({ key: 1, items: "<li>1</li>" })}</ul>${renderListingMore({ key: 1, href: "/blog/_more/1/1" })}`,
    { url: "https://site.test/blog", runScripts: "outside-only" }
  );
  const window = dom.window as unknown as Window & typeof globalThis & { eval(code: string): void };
  const requested: string[] = [];
  window.fetch = (async (url: string) => {
    const path = new URL(url, "https://site.test").pathname;
    requested.push(path);
    const body = batches[path];
    if (body === undefined || body instanceof Error) throw body ?? new Error("no batch");
    return { ok: true, text: async () => body };
  }) as unknown as typeof fetch;
  window.eval(LISTING_SEE_MORE_SCRIPT);
  const doc = window.document;
  const link = () => doc.querySelector<HTMLButtonElement>("button[data-jini-more]");
  const items = () => Array.from(doc.querySelectorAll("li"), (li: Element) => li.textContent);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { window, requested, link, items, settle };
}

test("see-more script: reveals the button, shows Loading… while fetching, appends each batch, swaps the URL, and removes the button after the last batch", async () => {
  const p = page({
    "/blog/_more/1/1": renderListingBatchDocument({ key: 1, items: "<li>2</li>", moreHref: "/blog/_more/1/2" }),
    "/blog/_more/1/2": renderListingBatchDocument({ key: 1, items: "<li>3</li>" }),
  });
  assert.equal(p.link()?.hidden, false);
  assert.equal(p.link()?.type, "button");
  p.link()!.click();
  assert.equal(p.link()?.disabled, true);
  assert.equal(p.link()?.textContent, "Loading…");
  assert.equal(p.link()?.getAttribute("aria-busy"), "true");
  p.link()!.click(); // in flight: ignored
  await p.settle();
  assert.deepEqual(p.items(), ["1", "2"]);
  assert.equal(p.link()?.getAttribute("data-jini-more-href"), "/blog/_more/1/2");
  assert.equal(p.link()?.disabled, false);
  assert.equal(p.link()?.textContent, "See more");
  p.link()!.click();
  await p.settle();
  assert.deepEqual(p.items(), ["1", "2", "3"]);
  assert.equal(p.link(), null);
  assert.deepEqual(p.requested, ["/blog/_more/1/1", "/blog/_more/1/2"]);
});

test("see-more script: a failed fetch restores and re-enables the button", async () => {
  const p = page({ "/blog/_more/1/1": new Error("offline") });
  p.link()!.click();
  await p.settle();
  assert.deepEqual(p.items(), ["1"]);
  assert.equal(p.link()?.getAttribute("aria-busy"), null);
  assert.equal(p.link()?.disabled, false);
  assert.equal(p.link()?.textContent, "See more");
  p.link()!.click();
  await p.settle();
  assert.equal(p.requested.length, 2, "the button works again after a failure");
});
