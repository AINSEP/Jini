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

function page(batches: Record<string, string | Error>, { card = "", href = "/blog/_more/1/1" }: { card?: string; href?: string } = {}) {
  const dom = new JSDOM(
    `<ul data-jini-listing="1">${card}${wrapListingItems({ key: 1, items: "<li>1</li>" })}</ul>${renderListingMore({ key: 1, href })}`,
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

const CARD =
  '<template data-jini-card><li><a data-field="title" data-field-href="href" data-field-onclick="title"></a>' +
  '<img data-field-src="cover.url" data-field-alt="cover.alt" data-field-width="cover.width"><p data-field="excerpt"></p><i data-field="terms"></i></li></template>';

test("see-more script: a .json batch fills the card template per item with text and safe attributes only, then follows nextCursor", async () => {
  const hostile = '<img src=x onerror="window.pwned=1">';
  const p = page(
    {
      "/blog/_more/1/1.json": JSON.stringify({
        items: [
          { title: hostile, href: "/posts/a", cover: { url: "/m/a.jpg", alt: "A", width: null }, excerpt: "Hi", terms: ["x", "y"] },
          { title: "B", href: "javascript:alert(1)", cover: null, excerpt: "" },
        ],
        nextCursor: 3,
      }),
      "/blog/_more/1/3.json": JSON.stringify({ items: [{ title: "C", href: "https://other.test/c" }], nextCursor: null }),
    },
    { card: CARD, href: "/blog/_more/1/1.json" }
  );
  p.link()!.click();
  await p.settle();
  const lis = p.window.document.querySelectorAll("ul > li");
  assert.equal(lis.length, 3);
  const first = lis[1]!;
  assert.equal(first.querySelector("a")?.textContent, hostile, "data is text, never markup");
  assert.equal(first.querySelectorAll("img").length, 1, "only the bound cover img, no injected one");
  assert.equal(first.querySelector("a")?.getAttribute("href"), "/posts/a");
  assert.equal(first.querySelector("a")?.hasAttribute("onclick"), false, "attributes outside the allowlist are never set");
  assert.equal(first.querySelector("img")?.getAttribute("src"), "/m/a.jpg");
  assert.equal(first.querySelector("img")?.getAttribute("alt"), "A");
  assert.equal(first.querySelector("img")?.hasAttribute("width"), false);
  assert.equal(first.querySelector("i")?.textContent, "x, y");
  assert.equal(first.outerHTML.includes("data-field"), false, "bindings are removed once filled");
  const second = lis[2]!;
  assert.equal(second.querySelector("a"), null, "a javascript: href drops its element");
  assert.equal(second.querySelector("img"), null, "no cover drops the img");
  assert.equal(second.querySelector("p"), null, "an empty excerpt drops its element");
  assert.equal((p.window as unknown as { pwned?: number }).pwned, undefined);
  assert.equal(p.link()?.getAttribute("data-jini-more-href"), "/blog/_more/1/3.json");
  p.link()!.click();
  await p.settle();
  assert.equal(p.window.document.querySelectorAll("ul > li").length, 4);
  assert.equal(p.window.document.querySelectorAll("ul > li")[3]!.querySelector("a")?.getAttribute("href"), "https://other.test/c");
  assert.equal(p.link(), null);
  assert.deepEqual(p.requested, ["/blog/_more/1/1.json", "/blog/_more/1/3.json"]);
});

test("see-more script: a .json URL without a card template, or a malformed body, leaves the button usable", async () => {
  const p = page({ "/blog/_more/1/1.json": "<html>not json</html>" }, { card: CARD, href: "/blog/_more/1/1.json" });
  p.link()!.click();
  await p.settle();
  assert.deepEqual(p.items(), ["1"]);
  assert.equal(p.link()?.disabled, false);
  const bare = page({}, { href: "/blog/_more/1/1.json" });
  bare.link()!.click();
  await bare.settle();
  assert.equal(bare.link()?.disabled, false);
  assert.deepEqual(bare.requested, []);
});
