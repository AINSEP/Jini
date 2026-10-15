/** rendr: execute the serialized DOM projection against injected DOM/style fakes. */
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { publicPageExpression } from "../web-evidence/public-page.js";

function node(tagName: string, values: Record<string, string> = {}) {
  return { tagName, src: values.src, currentSrc: values.currentSrc, alt: values.alt,
    closest: () => null, getAttribute: (name: string) => values[name] ?? null };
}

test("rendered image facts include absolute src, srcset candidates and computed CSS backgrounds", () => {
  const originals = [node("IMG", { src: "/fallback.jpg", currentSrc: "/large.jpg", srcset: "/small.jpg 1x, /large.jpg 2x", alt: "Example" }), node("DIV"), node("SCRIPT"), node("SPAN")];
  const removed: number[] = [];
  const clones = originals.map((_n, index) => ({ remove: () => { removed.push(index); } }));
  const copy = { outerHTML: "<h1>Rendered title</h1>", querySelectorAll: (selector: string) => selector === "*" ? clones : [], cloneNode: () => copy };
  const result = runInNewContext(publicPageExpression({ maxChars: 8 }), {
    URL, document: { baseURI: "https://example.com/", title: "Title", body: { innerText: "Live text is longer" }, documentElement: { cloneNode: () => copy, querySelectorAll: () => originals } },
    getComputedStyle: (element: typeof originals[number]) => ({ display: element.tagName === "SPAN" ? "none" : "block", visibility: "visible", backgroundImage: element.tagName === "DIV" ? "url('/background.png')" : "none" }),
  });
  // Convert cross-realm values to host objects; the script has no module helpers or browser globals.
  const facts = JSON.parse(JSON.stringify(result));
  expect(facts.images).toEqual([
    { src: "https://example.com/large.jpg", alt: "Example" },
    { src: "https://example.com/fallback.jpg", alt: "Example" },
    { src: "https://example.com/small.jpg", alt: "Example" },
    { src: "https://example.com/background.png", alt: "" },
  ]);
  expect(facts.text).toBe("Live tex"); expect(facts.truncated).toBe(true);
  expect(removed).toEqual([2, 3]);
});

test("large image lists and long DOM/text output are capped and marked truncated", () => {
  const originals = Array.from({ length: 310 }, (_unused, i) => node("IMG", { src: `/image-${i}.png` }));
  const copy = { outerHTML: "x".repeat(1_000_001), querySelectorAll: (selector: string) => selector === "*" ? originals.map(() => ({ remove: () => {} })) : [] };
  const result = runInNewContext(publicPageExpression({ maxChars: 1 }), {
    URL, document: { baseURI: "https://example.com/", title: "T".repeat(500), body: { innerText: "long" }, documentElement: { cloneNode: () => copy, querySelectorAll: () => originals } },
    getComputedStyle: () => ({ display: "block", visibility: "visible", backgroundImage: "none" }),
  });
  expect(result.images).toHaveLength(300); expect(result.imagesTruncated).toBe(true);
  expect(result.title).toHaveLength(300); expect(result.html).toBe("x".repeat(1_000_000)); expect(result.text).toBe("l"); expect(result.truncated).toBe(true);
});

test("browser capture retains a huge style head and body independently of the text budget", () => {
  const maxChars = 60_000;
  const text = 'Readable storefront content. '.repeat(3000);
  const html = `<html><head><style>${'c'.repeat(maxChars * 4 + 1)}</style></head><body><p>${text}</p></body></html>`;
  const copy = { outerHTML: html, querySelectorAll: () => [] };
  const result = runInNewContext(publicPageExpression({ maxChars }), {
    document: { title: 'Storefront', body: { innerText: text }, documentElement: { cloneNode: () => copy, querySelectorAll: () => [] } },
  });
  expect(result.html).toBe(html);
  expect(result.text).toBe(text.slice(0, maxChars));
  expect(result.truncated).toBe(true);
});

test.each([
  [undefined, 1500, false], ["full", 1500, false], ["none", 0, false], ["summary", 1000, true],
] as const)("textMode %s bounds visible text without changing DOM facts", (textMode, length, truncated) => {
  const copy = { outerHTML: '<p>DOM content</p>', querySelectorAll: () => [] };
  const body = { get innerText() { if (textMode === "none") throw new Error("data-only mode must not extract innerText"); return "v".repeat(1500); } };
  const result = runInNewContext(publicPageExpression({ maxChars: 2000, ...(textMode ? { textMode } : {}) }), {
    URL, document: { baseURI: "https://example.com/", title: "Title", body, documentElement: { cloneNode: () => copy, querySelectorAll: () => [] } },
  });
  expect(result.text).toBe("v".repeat(length));
  expect(result.html).toBe('<p>DOM content</p>'); expect(result.title).toBe("Title"); expect(result.truncated).toBe(truncated);
});

test("summary obeys a smaller maxChars and does not split surrogate pairs", () => {
  const copy = { outerHTML: '<p>DOM</p>', querySelectorAll: () => [] };
  const result = runInNewContext(publicPageExpression({ maxChars: 4, textMode: "summary" }), {
    URL, document: { title: "Title", body: { innerText: "abc😀tail" }, documentElement: { cloneNode: () => copy, querySelectorAll: () => [] } },
  });
  expect(result.text).toBe("abc"); expect(result.truncated).toBe(true);
});
