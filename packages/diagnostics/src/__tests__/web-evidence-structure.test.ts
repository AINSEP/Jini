import assert from "node:assert/strict";
import { test } from "vitest";

import { collectPageStructure, type PageStructureCapture, type PageStructureLimits } from "../web-evidence/page-structure-script.js";

/**
 * @file `collectPageStructure()` exercised directly, through a hand-built DOM/CSSOM double.
 *
 * ---------------------------------------------------------------------------
 * Execution model finding — read before extending this file
 * ---------------------------------------------------------------------------
 * `collectPageStructure` is never imported and called by production code running in THIS process.
 * Per its own file header and `playwright-browser.ts`'s `buildPageStructureExpression`, the
 * function is `.toString()`-serialized and evaluated INSIDE a real Chromium page by
 * `playwright-browser.ts`'s `observe()` — exercised by
 * `../integration/playwright-browser.integration.test.ts` against a real browser, in a separate
 * OS process. `node`'s own V8 coverage instrumentation cannot see code that runs in that other
 * process at all.
 *
 * That means the ~49.5% line-coverage figure this file previously carried did not come from any of
 * this function's LOGIC executing under test — it came from the module simply loading (every
 * top-level statement, and each nested function's own one-line declaration, counts as "hit" once
 * at parse/definition time) while nothing inside those nested function BODIES ever ran in the Node
 * process. The integration test proves the function works in a real browser; it proves nothing to
 * `node --experimental-test-coverage`.
 *
 * There is no DOM-emulation package (jsdom/happy-dom/linkedom) anywhere in this workspace, and the
 * file's own header forbids hoisting its helpers to module scope (Playwright serializes only the
 * function's own source text, so a hoisted helper would leave a dangling reference at runtime in
 * the page). So neither of the two routes the TDD skill would normally reach for — "import
 * normally against a DOM stub" or "export the pure helpers and test them directly" — is available.
 * `collectPageStructure` is also the ONLY externally reachable symbol; every nested helper
 * (`selectorFor`, `collectHeadings`, `collectContrastSamples`, `effectiveBackground`, …) is private
 * to its closure and cannot be imported or called on its own.
 *
 * This suite instead builds the smallest DOM/CSSOM double that satisfies exactly the surface
 * `collectPageStructure` touches (`document`, `getComputedStyle`, `CSS.escape`), installs it on
 * `globalThis` for the duration of one synchronous call, and drives every nested helper indirectly
 * by shaping the markup and computed styles fed to that one public entry point. Each call to
 * `collect()` below is fully synchronous end to end, so installing the double on `globalThis` is
 * safe even under concurrent test execution — nothing yields the event loop while it is installed.
 */

// ---------------------------------------------------------------------------------------------
// A minimal DOM/CSSOM double — just enough surface for collectPageStructure, nothing more.
// ---------------------------------------------------------------------------------------------

class FakeElement {
  readonly tagName: string;
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  textContent: string | null = "";
  innerText: string | null = "";
  style: Record<string, string> = {};
  private readonly attrs = new Map<string, string>();

  constructor(tag: string, options: { id?: string; text?: string; attrs?: Record<string, string> } = {}) {
    this.tagName = tag.toUpperCase();
    if (options.id !== undefined) this.attrs.set("id", options.id);
    for (const [name, value] of Object.entries(options.attrs ?? {})) this.attrs.set(name, value);
    if (options.text !== undefined) this.textContent = options.text;
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  append(...kids: FakeElement[]): this {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }

  closest(tag: string): FakeElement | null {
    const wanted = tag.toUpperCase();
    let current: FakeElement | null = this;
    while (current) {
      if (current.tagName === wanted) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matchers = compileSelectorList(selector);
    const found: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (matchers.some((matches) => matches(child))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

/** Compiles the small, fixed set of selector shapes `page-structure-script.ts` actually writes: a
 *  bare tag name, `[attr]` presence, `[attr='value']` / `tag[attr="value"]` equality — comma
 *  separated. Not a CSS engine; a purpose-built double for exactly this file's own selectors. */
function compileSelectorList(selectorList: string): Array<(el: FakeElement) => boolean> {
  return selectorList.split(",").map((raw) => {
    const part = raw.trim();
    const attr = /^([a-zA-Z0-9]*)\[([a-zA-Z-]+)(?:=(['"])(.*?)\3)?\]$/.exec(part);
    if (attr) {
      const [, tag, name, , value] = attr;
      return (el: FakeElement) => {
        if (tag && el.tagName !== tag.toUpperCase()) return false;
        return value === undefined ? el.hasAttribute(name as string) : el.getAttribute(name as string) === value;
      };
    }
    const tag = part.toUpperCase();
    return (el: FakeElement) => el.tagName === tag;
  });
}

class FakeDocument {
  title = "";
  documentElement: FakeElement;
  body: FakeElement | null;

  /** `rootTag` defaults to "html" — the ordinary case. Tests that exercise `selectorFor`'s
   *  no-parent branch pass a non-HTML root to model a directly-loaded non-HTML top-level document
   *  (e.g. an `.svg`/XML resource), whose root element is never intercepted by the "html"/"body"
   *  terminal check. */
  constructor(rootTag = "html") {
    this.documentElement = new FakeElement(rootTag);
    this.body = rootTag === "html" ? new FakeElement("body") : null;
    if (this.body) this.documentElement.append(this.body);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }

  getElementById(id: string): FakeElement | null {
    let found: FakeElement | null = null;
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (!found && child.id === id) found = child;
        if (!found) walk(child);
      }
    };
    walk(this.documentElement);
    return found;
  }
}

/** Escapes the way `CSS.escape` would for the plain identifiers these tests use. Not a spec-exact
 *  polyfill (Node has no `CSS` global at all) — just enough to prove the production code's calls to
 *  `CSS.escape` are on the id-bearing path and to keep produced selectors deterministic. */
function fakeCssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

interface StyleInput {
  color?: string;
  backgroundColor?: string;
  visibility?: string;
  display?: string;
  fontSize?: string;
  fontWeight?: string;
}

function fakeGetComputedStyle(element: FakeElement): CSSStyleDeclaration {
  const style = element.style as StyleInput;
  return {
    color: style.color ?? "rgb(0, 0, 0)",
    backgroundColor: style.backgroundColor ?? "rgba(0, 0, 0, 0)",
    visibility: style.visibility ?? "visible",
    display: style.display ?? "block",
    fontSize: style.fontSize ?? "16px",
    fontWeight: style.fontWeight ?? "400",
  } as unknown as CSSStyleDeclaration;
}

const DEFAULT_LIMITS: PageStructureLimits = {
  maxTextExcerptChars: 2_000,
  maxNodesPerCategory: 200,
  maxContrastSamples: 40,
  collectAccessibility: true,
};

function withLimits(overrides: Partial<PageStructureLimits> = {}): PageStructureLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

/** Installs the DOM/CSSOM double on `globalThis`, runs `collectPageStructure` once synchronously,
 *  and restores whatever was there before. See the file header for why this is safe under
 *  concurrent test execution. */
function collect(
  build: (doc: FakeDocument) => void,
  limitOverrides: Partial<PageStructureLimits> = {},
  rootTag = "html",
): PageStructureCapture {
  const doc = new FakeDocument(rootTag);
  build(doc);

  const g = globalThis as Record<string, unknown>;
  const previous = { document: g.document, getComputedStyle: g.getComputedStyle, CSS: g.CSS };
  g.document = doc;
  g.getComputedStyle = fakeGetComputedStyle;
  g.CSS = { escape: fakeCssEscape };
  try {
    return collectPageStructure(withLimits(limitOverrides));
  } finally {
    g.document = previous.document;
    g.getComputedStyle = previous.getComputedStyle;
    g.CSS = previous.CSS;
  }
}

function el(tag: string, options?: { id?: string; text?: string; attrs?: Record<string, string> }): FakeElement {
  return new FakeElement(tag, options);
}

// ---------------------------------------------------------------------------------------------
// Document-level facts and the collectAccessibility toggle
// ---------------------------------------------------------------------------------------------

test("title, lang, and a short body text excerpt are read straight from the document", () => {
  const result = collect((doc) => {
    doc.title = "Example Page";
    doc.documentElement.setAttribute("lang", "en");
    doc.body!.innerText = "Hello world";
  });

  assert.equal(result.title, "Example Page");
  assert.equal(result.lang, "en");
  assert.equal(result.textExcerpt, "Hello world");
  assert.equal(result.textTruncated, false);
});

test("a missing lang attribute reports null, not a guessed default", () => {
  const result = collect(() => {});
  assert.equal(result.lang, null);
});

test("body text over the cap is truncated and textTruncated is set", () => {
  const result = collect(
    (doc) => {
      doc.body!.innerText = "abcdefghij";
    },
    { maxTextExcerptChars: 5 },
  );

  assert.equal(result.textExcerpt, "abcde");
  assert.equal(result.textTruncated, true);
});

test("a document with no <body> (e.g. a frameset document) degrades to an empty excerpt", () => {
  const result = collect((doc) => {
    doc.body = null;
  });
  assert.equal(result.textExcerpt, "");
  assert.equal(result.textTruncated, false);
});

test("collectAccessibility: false skips every collector and marks the whole category not-collected", () => {
  const result = collect(
    (doc) => {
      doc.documentElement.append(el("img", { attrs: { src: "/x.png" } }));
    },
    { collectAccessibility: false },
  );

  assert.deepEqual(result.accessibility, {
    landmarks: [],
    headings: [],
    images: [],
    formControls: [],
    contrastSamples: [],
    truncated: ["not-collected"],
  });
});

test("an accessibility-collecting pass over an otherwise empty document returns empty categories", () => {
  const result = collect(() => {});
  assert.deepEqual(result.accessibility, {
    landmarks: [],
    headings: [],
    images: [],
    formControls: [],
    contrastSamples: [],
    truncated: [],
  });
});

// ---------------------------------------------------------------------------------------------
// selectorFor / terminalSegment / siblingSegment — driven through collectImages(), since every
// <img> is included unconditionally, isolating selector generation from any collector-specific
// filtering.
// ---------------------------------------------------------------------------------------------

test("an element with its own id short-circuits to '#id', ignoring its ancestry entirely", () => {
  const result = collect((doc) => {
    doc.body!.append(el("div").append(el("div").append(el("img", { id: "hero", attrs: { src: "/a.png" } }))));
  });
  assert.equal(result.accessibility.images[0]?.selector, "#hero");
});

test("an id needing escaping is passed through CSS.escape, not used raw", () => {
  const rawId = "a:b c";
  const result = collect((doc) => {
    doc.body!.append(el("img", { id: rawId, attrs: { src: "/a.png" } }));
  });
  assert.equal(result.accessibility.images[0]?.selector, `#${fakeCssEscape(rawId)}`);
});

test("with no id anywhere, the walk terminates at the <body> tag", () => {
  const result = collect((doc) => {
    doc.body!.append(el("div").append(el("div").append(el("img", { attrs: { src: "/a.png" } }))));
  });
  assert.equal(result.accessibility.images[0]?.selector, "body > div > div > img");
});

test("with no id anywhere and no <body> in the chain, the walk terminates at the <html> tag", () => {
  const result = collect((doc) => {
    doc.documentElement.append(el("img", { attrs: { src: "/a.png" } }));
  });
  assert.equal(result.accessibility.images[0]?.selector, "html > img");
});

test("an ancestor's own id ends the walk early, without climbing all the way to <body>", () => {
  const result = collect((doc) => {
    doc.body!.append(el("div", { id: "panel" }).append(el("span").append(el("img", { attrs: { src: "/a.png" } }))));
  });
  assert.equal(result.accessibility.images[0]?.selector, "#panel > span > img");
});

test("siblings sharing a tag get an nth-of-type index; a lone sibling of its tag does not", () => {
  const gallery = el("div", { id: "gallery" });
  const soloParent = el("div", { id: "solo" });
  const result = collect((doc) => {
    gallery.append(el("img", { attrs: { src: "/1.png" } }), el("p", { text: "caption" }), el("img", { attrs: { src: "/2.png" } }));
    soloParent.append(el("img", { attrs: { src: "/3.png" } }), el("p", { text: "caption" }));
    doc.body!.append(gallery, soloParent);
  });

  const [first, second, third] = result.accessibility.images;
  assert.equal(first?.selector, "#gallery > img:nth-of-type(1)");
  assert.equal(second?.selector, "#gallery > img:nth-of-type(2)");
  assert.equal(third?.selector, "#solo > img");
});

test("the walk stops after 5 ancestor hops even when none of html, body, or an id was ever reached", () => {
  const chain = el("div").append(el("div").append(el("div").append(el("div").append(el("div").append(el("img", { attrs: { src: "/a.png" } }))))));
  const result = collect((doc) => {
    doc.body!.append(chain);
  });
  assert.equal(result.accessibility.images[0]?.selector, "div > div > div > div > img");
});

test("a non-HTML top-level document (e.g. a directly-loaded SVG resource) ends the walk at its own root, via the no-parent branch", () => {
  const result = collect(
    (doc) => {
      doc.documentElement.append(el("g").append(el("img", { attrs: { src: "/a.png" } })));
    },
    {},
    "svg",
  );
  assert.equal(result.accessibility.images[0]?.selector, "svg > g > img");
});

// ---------------------------------------------------------------------------------------------
// textOf — whitespace collapsing, truncation, and a null textContent
// ---------------------------------------------------------------------------------------------

test("heading text is whitespace-collapsed and trimmed", () => {
  const heading = el("h1", { text: "  Hello   \n World  " });
  const result = collect((doc) => doc.body!.append(heading));
  assert.equal(result.accessibility.headings[0]?.text, "Hello World");
});

test("heading text over 160 characters is truncated with an ellipsis", () => {
  const heading = el("h1", { text: "a".repeat(200) });
  const result = collect((doc) => doc.body!.append(heading));
  const text = result.accessibility.headings[0]?.text ?? "";
  assert.equal(text.length, 161);
  assert.equal(text, `${"a".repeat(160)}…`);
});

test("a null textContent contributes an empty string rather than throwing", () => {
  const heading = el("h2");
  heading.textContent = null;
  const result = collect((doc) => doc.body!.append(heading));
  assert.equal(result.accessibility.headings[0]?.text, "");
});

// ---------------------------------------------------------------------------------------------
// accessibleNameOf and its five strategies, tried in spec order — driven through
// collectFormControls() inputs.
// ---------------------------------------------------------------------------------------------

test("aria-label wins over every other strategy when present and non-blank", () => {
  const label = el("label", { attrs: { for: "q" }, text: "Ignored label" });
  const input = el("input", { id: "q", attrs: { "aria-label": "Email address", title: "Ignored title" } });
  const result = collect((doc) => doc.body!.append(label, input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Email address");
  assert.equal(control?.labelSource, "aria-label");
});

test("a blank aria-label falls through to aria-labelledby", () => {
  const target = el("span", { id: "lbl1", text: "Label One" });
  const input = el("input", { attrs: { "aria-label": "   ", "aria-labelledby": "lbl1" } });
  const result = collect((doc) => doc.body!.append(target, input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Label One");
  assert.equal(control?.labelSource, "aria-labelledby");
});

test("aria-labelledby joins multiple referenced ids and skips ones that don't resolve", () => {
  const a = el("span", { id: "a", text: "First" });
  const b = el("span", { id: "b", text: "Second" });
  const input = el("input", { attrs: { "aria-labelledby": "a missing b" } });
  const result = collect((doc) => doc.body!.append(a, b, input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "First Second");
  assert.equal(control?.labelSource, "aria-labelledby");
});

test("aria-labelledby referencing only missing ids resolves to nothing, and the search falls through", () => {
  const label = el("label", { attrs: { for: "q" }, text: "Label For Text" });
  const input = el("input", { id: "q", attrs: { "aria-labelledby": "ghost" } });
  const result = collect((doc) => doc.body!.append(label, input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Label For Text");
  assert.equal(control?.labelSource, "label-for");
});

test("no aria-labelledby attribute at all skips straight past that strategy", () => {
  const label = el("label", { attrs: { for: "q" }, text: "Label For Text" });
  const input = el("input", { id: "q" });
  const result = collect((doc) => doc.body!.append(label, input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Label For Text");
  assert.equal(control?.labelSource, "label-for");
});

test("no id at all means label-for is skipped outright, falling to a wrapping label", () => {
  const wrapper = el("label", { text: "Wrapped Label Text" });
  const input = el("input");
  const result = collect((doc) => doc.body!.append(wrapper.append(input)));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Wrapped Label Text");
  assert.equal(control?.labelSource, "label-wrap");
});

test("an id with a matching label[for] whose text is blank falls through past label-for AND past an absent label-wrap", () => {
  const blankLabel = el("label", { attrs: { for: "x" }, text: "   " });
  const input = el("input", { id: "x", attrs: { title: "Fallback Title" } });
  const result = collect((doc) => doc.body!.append(blankLabel, input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Fallback Title");
  assert.equal(control?.labelSource, "title");
});

test("a wrapping label whose text is blank falls through to title", () => {
  const wrapper = el("label", { text: "   " });
  const input = el("input", { attrs: { title: "Titled" } });
  const result = collect((doc) => doc.body!.append(wrapper.append(input)));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, "Titled");
  assert.equal(control?.labelSource, "title");
});

test("a blank title exhausts every strategy, resolving to name: null, source: 'none'", () => {
  const input = el("input", { attrs: { title: "   " } });
  const result = collect((doc) => doc.body!.append(input));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, null);
  assert.equal(control?.labelSource, "none");
});

test("a control with no naming attribute at all also resolves to name: null, source: 'none'", () => {
  const select = el("select");
  const result = collect((doc) => doc.body!.append(select));
  const control = result.accessibility.formControls[0];
  assert.equal(control?.accessibleName, null);
  assert.equal(control?.labelSource, "none");
});

// ---------------------------------------------------------------------------------------------
// collectLandmarks
// ---------------------------------------------------------------------------------------------

test("each landmark tag gets its spec-implicit role when no explicit role is present", () => {
  const result = collect((doc) => {
    doc.body!.append(el("header"), el("nav"), el("main"), el("aside"), el("footer"), el("form"), el("section"));
  });
  assert.deepEqual(
    result.accessibility.landmarks.map((l) => l.role),
    ["banner", "navigation", "main", "complementary", "contentinfo", "form", "region"],
  );
});

test("an explicit role attribute overrides the implicit one", () => {
  const result = collect((doc) => doc.body!.append(el("nav", { attrs: { role: "menu" } })));
  assert.equal(result.accessibility.landmarks[0]?.role, "menu");
});

test("any element bearing a bare role attribute is picked up, even off the landmark tag list", () => {
  const result = collect((doc) => doc.body!.append(el("div", { attrs: { role: "alert" } })));
  assert.equal(result.accessibility.landmarks[0]?.role, "alert");
});

test("a blank role on a tag with no implicit mapping is skipped entirely", () => {
  const result = collect((doc) => doc.body!.append(el("div", { attrs: { role: "   " } })));
  assert.equal(result.accessibility.landmarks.length, 0);
});

test("a blank role on a tag that DOES have an implicit mapping still falls back to it", () => {
  const result = collect((doc) => doc.body!.append(el("section", { attrs: { role: "   " } })));
  assert.equal(result.accessibility.landmarks[0]?.role, "region");
});

test("a landmark's accessibleName is computed the same way as everywhere else", () => {
  const result = collect((doc) => doc.body!.append(el("nav", { attrs: { "aria-label": "Primary" } })));
  assert.equal(result.accessibility.landmarks[0]?.accessibleName, "Primary");
});

test("landmarks beyond the per-category cap are truncated and reported", () => {
  const result = collect((doc) => doc.body!.append(el("nav", { id: "first" }), el("header", { id: "second" })), { maxNodesPerCategory: 1 });
  assert.equal(result.accessibility.landmarks.length, 1);
  assert.deepEqual(result.accessibility.landmarks.map((item) => item.selector), ["#first"]);
  assert.deepEqual(result.accessibility.truncated, ["landmarks"]);
});

// ---------------------------------------------------------------------------------------------
// collectHeadings
// ---------------------------------------------------------------------------------------------

test("heading level comes from the tag for h1..h6, in document order", () => {
  const result = collect((doc) => {
    doc.body!.append(el("h1"), el("h2"), el("h3"), el("h4"), el("h5"), el("h6"));
  });
  assert.deepEqual(
    result.accessibility.headings.map((h) => h.level),
    [1, 2, 3, 4, 5, 6],
  );
});

test("an aria-level on a role=heading element is used when the tag itself isn't a heading", () => {
  const result = collect((doc) => doc.body!.append(el("div", { attrs: { role: "heading", "aria-level": "3" }, text: "Custom" })));
  assert.equal(result.accessibility.headings[0]?.level, 3);
});

test("role=heading with no aria-level is skipped (level resolves to 0)", () => {
  const result = collect((doc) => doc.body!.append(el("div", { attrs: { role: "heading" }, text: "No level" })));
  assert.equal(result.accessibility.headings.length, 0);
});

test("role=heading with a non-numeric aria-level is skipped (NaN is not finite)", () => {
  const result = collect((doc) => doc.body!.append(el("div", { attrs: { role: "heading", "aria-level": "abc" }, text: "Bad level" })));
  assert.equal(result.accessibility.headings.length, 0);
});

test("role=heading with aria-level='0' is skipped, just like a genuinely absent level", () => {
  const result = collect((doc) => doc.body!.append(el("div", { attrs: { role: "heading", "aria-level": "0" }, text: "Zero level" })));
  assert.equal(result.accessibility.headings.length, 0);
});

test("headings beyond the per-category cap are truncated and reported", () => {
  const result = collect((doc) => doc.body!.append(el("h1", { id: "first", text: "First" }), el("h2", { id: "second", text: "Second" })), { maxNodesPerCategory: 1 });
  assert.equal(result.accessibility.headings.length, 1);
  assert.deepEqual(result.accessibility.headings, [{ level: 1, selector: "#first", text: "First" }]);
  assert.deepEqual(result.accessibility.truncated, ["headings"]);
});

// ---------------------------------------------------------------------------------------------
// collectImages
// ---------------------------------------------------------------------------------------------

test("alt text distinguishes present-empty, present-with-text, and wholly absent", () => {
  const result = collect((doc) => {
    doc.body!.append(el("img", { attrs: { src: "/a.png", alt: "" } }), el("img", { attrs: { src: "/b.png", alt: "Photo" } }), el("img", { attrs: { src: "/c.png" } }));
  });
  assert.deepEqual(
    result.accessibility.images.map((i) => i.alt),
    ["", "Photo", null],
  );
});

test("aria-hidden is true only for the literal string 'true'", () => {
  const result = collect((doc) => {
    doc.body!.append(
      el("img", { attrs: { src: "/a.png", "aria-hidden": "true" } }),
      el("img", { attrs: { src: "/b.png", "aria-hidden": "false" } }),
      el("img", { attrs: { src: "/c.png" } }),
    );
  });
  assert.deepEqual(
    result.accessibility.images.map((i) => i.ariaHidden),
    [true, false, false],
  );
});

test("src falls back to an empty string when the attribute is absent", () => {
  const result = collect((doc) => doc.body!.append(el("img")));
  assert.equal(result.accessibility.images[0]?.src, "");
});

// ---------------------------------------------------------------------------------------------
// collectFormControls
// ---------------------------------------------------------------------------------------------

test("a hidden input is excluded; other input types are not", () => {
  const result = collect((doc) => {
    doc.body!.append(el("input", { attrs: { type: "hidden" } }), el("input", { attrs: { type: "text" } }));
  });
  assert.equal(result.accessibility.formControls.length, 1);
  assert.equal(result.accessibility.formControls[0]?.type, "text");
});

test("select and textarea are included regardless of any 'type' concept", () => {
  const result = collect((doc) => doc.body!.append(el("select"), el("textarea")));
  assert.deepEqual(
    result.accessibility.formControls.map((c) => c.tag),
    ["select", "textarea"],
  );
});

test("required is true via the required attribute, via aria-required='true', or neither", () => {
  const result = collect((doc) => {
    doc.body!.append(
      el("input", { attrs: { required: "" } }),
      el("input", { attrs: { "aria-required": "true" } }),
      el("input", { attrs: { "aria-required": "false" } }),
      el("input"),
    );
  });
  assert.deepEqual(
    result.accessibility.formControls.map((c) => c.required),
    [true, true, false, false],
  );
});

test("name reflects the raw attribute, including when it is absent", () => {
  const result = collect((doc) => doc.body!.append(el("input", { attrs: { name: "email" } }), el("input")));
  assert.deepEqual(
    result.accessibility.formControls.map((c) => c.name),
    ["email", null],
  );
});

// ---------------------------------------------------------------------------------------------
// contrast: parseColor, relativeLuminance, effectiveBackground, sampling, and its own cap
// ---------------------------------------------------------------------------------------------

test("black on white yields the maximum ratio, exercising both the low and high luminance channel branches", () => {
  const bg = el("div", { attrs: {} });
  bg.style.backgroundColor = "rgb(255, 255, 255)";
  const sample = el("span", { text: "Contrast me" });
  sample.style.color = "rgb(0, 0, 0)";
  sample.style.fontSize = "18px";
  sample.style.fontWeight = "700";
  bg.append(sample);

  const result = collect((doc) => doc.body!.append(bg));
  const [found] = result.accessibility.contrastSamples;
  assert.equal(found?.ratio, 21);
  assert.equal(found?.fontSizePx, 18);
  assert.equal(found?.fontWeight, 700);
});

test("an rgba() foreground with an explicit alpha is parsed via the 4-component branch", () => {
  const sample = el("span", { text: "Text" });
  sample.style.color = "rgba(20, 30, 40, 0.8)";
  const result = collect((doc) => doc.body!.append(sample));
  assert.equal(result.accessibility.contrastSamples.length, 1);
  assert.equal(result.accessibility.contrastSamples[0]?.foreground, "rgba(20, 30, 40, 0.8)");
  assert.equal(result.accessibility.contrastSamples[0]?.background, "rgb(255, 255, 255)");
  assert.equal(result.accessibility.contrastSamples[0]?.ratio, 8.86);
});

test("a 3-component rgb() foreground defaults its alpha via the else branch", () => {
  const sample = el("span", { text: "Text" });
  sample.style.color = "rgb(20, 30, 40)";
  const result = collect((doc) => doc.body!.append(sample));
  assert.equal(result.accessibility.contrastSamples.length, 1);
  assert.equal(result.accessibility.contrastSamples[0]?.foreground, "rgb(20, 30, 40)");
  assert.equal(result.accessibility.contrastSamples[0]?.ratio, 16.85);
});

test("effectiveBackground walks past transparent ancestors (both parseable-but-transparent and default) to an opaque one", () => {
  const grandparent = el("div");
  grandparent.style.backgroundColor = "rgb(200, 200, 200)";
  const parent = el("div");
  parent.style.backgroundColor = "rgba(0, 0, 0, 0)";
  const sample = el("span", { text: "Text" });
  // sample itself gets the fake's default backgroundColor, "rgba(0, 0, 0, 0)" — also transparent.
  grandparent.append(parent.append(sample));

  const result = collect((doc) => doc.body!.append(grandparent));
  assert.equal(result.accessibility.contrastSamples[0]?.background, "rgb(200, 200, 200)");
});

test("an unparseable background at every ancestor, up to the document root, falls back to white", () => {
  const sample = el("span", { text: "Text" });
  sample.style.backgroundColor = "transparent";
  const body = el("body");
  body.style.backgroundColor = "transparent";
  body.append(sample);

  const result = collect((doc) => {
    doc.body = body;
    doc.documentElement.style.backgroundColor = "transparent";
    doc.documentElement.append(body);
  });
  assert.equal(result.accessibility.contrastSamples[0]?.background, "rgb(255, 255, 255)");
});

test("a wrapper containing a nested sampleable descendant is excluded; the descendant itself is sampled", () => {
  const inner = el("span", { text: "Inner text" });
  const wrapper = el("p", { text: "Inner text" }).append(inner);
  const result = collect((doc) => doc.body!.append(wrapper));

  assert.equal(result.accessibility.contrastSamples.length, 1);
  assert.equal(result.accessibility.contrastSamples[0]?.selector, "body > p > span");
});

test("an element with no visible text of its own (whitespace only) is not sampled", () => {
  const blank = el("span", { text: "   " });
  const result = collect((doc) => doc.body!.append(blank));
  assert.equal(result.accessibility.contrastSamples.length, 0);
});

test("visibility: hidden and display: none both exclude an element; a plainly visible one is sampled", () => {
  const visible = el("span", { id: "visible", text: "Visible" });
  const hidden = el("span", { id: "hidden", text: "Hidden" });
  hidden.style.visibility = "hidden";
  const displayNone = el("span", { id: "gone", text: "Gone" });
  displayNone.style.display = "none";

  const result = collect((doc) => doc.body!.append(visible, hidden, displayNone));
  assert.deepEqual(
    result.accessibility.contrastSamples.map((c) => c.selector),
    ["#visible"],
  );
});

test("a computed colour the browser expresses outside rgb()/rgba() syntax cannot be sampled", () => {
  // Bucket 3 — a real browser's `getComputedStyle().color` is contractually not guaranteed to
  // always serialize as rgb()/rgba() (e.g. newer CSS Color 4 syntaxes in some engines). This drives
  // that defensive `!fg` branch in `contrastSampleFor` directly, through the one public entry point.
  const sample = el("span", { text: "Text" });
  sample.style.color = "oklch(0.5 0.1 200)";
  const result = collect((doc) => doc.body!.append(sample));
  assert.equal(result.accessibility.contrastSamples.length, 0);
  assert.deepEqual(result.accessibility.truncated, ["contrastSamples:unparsed-colour"]);
});

test("a partially-specified rgb() value (some but not all of r/g/b present) is also rejected", () => {
  const sample = el("span", { text: "Text" });
  sample.style.color = "rgb(10, 20)";
  const result = collect((doc) => doc.body!.append(sample));
  assert.equal(result.accessibility.contrastSamples.length, 0);
});

test("a syntactically rgb()-shaped but empty colour value is also rejected, and a non-numeric fontWeight falls back to 400", () => {
  const sample = el("span", { text: "Text" });
  sample.style.color = "rgb()";
  sample.style.fontWeight = "bold";
  const result = collect((doc) => doc.body!.append(sample));
  assert.equal(result.accessibility.contrastSamples.length, 0);

  // The fontWeight fallback can only be observed on a sample that DOES get parsed, so re-run with a
  // parseable colour and a non-numeric fontWeight.
  const sample2 = el("span", { text: "Text" });
  sample2.style.fontWeight = "bold";
  const result2 = collect((doc) => doc.body!.append(sample2));
  assert.equal(result2.accessibility.contrastSamples[0]?.fontWeight, 400);
});

test("the contrast sample cap truncates independently of the shared per-category cap, and is reported", () => {
  const result = collect(
    (doc) => doc.body!.append(el("span", { id: "first", text: "One" }), el("span", { id: "second", text: "Two" }), el("span", { id: "third", text: "Three" })),
    { maxContrastSamples: 1 },
  );
  assert.equal(result.accessibility.contrastSamples.length, 1);
  assert.deepEqual(result.accessibility.contrastSamples.map((item) => item.selector), ["#first"]);
  assert.deepEqual(result.accessibility.truncated, ["contrastSamples"]);
});

// Independently tabulated sRGB/WCAG contrast ratios against white, rounded to two decimals.
for (const [foreground, ratio] of [
  ["rgb(255, 0, 0)", 4],
  ["rgb(0, 255, 0)", 1.37],
  ["rgb(0, 0, 255)", 8.59],
  ["rgb(119, 119, 119)", 4.48],
  ["rgb(118, 118, 118)", 4.54],
] as const) {
  test(`${foreground} on white has contrast ${ratio}`, () => {
    const sample = el("span", { text: "Coloured text" });
    sample.style.color = foreground;
    const result = collect((doc) => doc.body!.append(sample));
    assert.equal(result.accessibility.contrastSamples[0]?.ratio, ratio);
  });
}

test("a translucent ancestor background is composited over its opaque ancestor", () => {
  const ancestor = el("div");
  ancestor.style.backgroundColor = "rgb(255, 255, 255)";
  const parent = el("div");
  parent.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  parent.append(el("span", { text: "Black text" }));
  ancestor.append(parent);
  const result = collect((doc) => doc.body!.append(ancestor));
  assert.equal(result.accessibility.contrastSamples[0]?.background, "rgb(127.5, 127.5, 127.5)");
  assert.equal(result.accessibility.contrastSamples[0]?.ratio, 5.28);
});

test("a child computing display:block beneath display:none is excluded", () => {
  const parent = el("div");
  parent.style.display = "none";
  const hidden = el("span", { id: "hidden-child", text: "Invisible text" });
  hidden.style.display = "block";
  parent.append(hidden);
  const result = collect((doc) => doc.body!.append(parent, el("span", { id: "visible", text: "Visible" })));
  assert.deepEqual(result.accessibility.contrastSamples.map((sample) => sample.selector), ["#visible"]);
});
