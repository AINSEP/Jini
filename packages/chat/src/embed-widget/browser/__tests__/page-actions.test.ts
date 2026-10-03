import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";

import { createBrowserPageActions, findTargetElement as find } from '../page-actions.js';
import type { BrowserPageActionController } from '../page-actions.js';
let actions: BrowserPageActionController;
const selection = { candidateSelector: "h1, h2, h3, h4, h5, h6, [class*='title']", excludedAncestorSelector: '.example-widget' };
const findTargetElement = (title: string, root: ParentNode = document) => find({ title, root, selection });
const applyHighlight = (element: Element) => actions.applyHighlight({ element });
const clearHighlight = () => actions.clearHighlight({});
const scrollToElement = (element: Element) => actions.scrollToElement({ element });

/** Generalized characterization cases from the source widget; effect ports are injected. */

let dom: JSDOM;
const installedGlobals = ["window", "document", "Element", "Event", "getComputedStyle"] as const;
const savedGlobals: Partial<Record<(typeof installedGlobals)[number], unknown>> = {};
/** Untyped view of `globalThis` for this file's temporary jsdom installation only — see the
 *  `describe` block's own doc for why this module patches bare globals rather than taking them as
 *  parameters. */
const untypedGlobal = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  dom = new JSDOM(
    `<!doctype html><html><body>
      <div class="example-widget"><h1>Ask this site</h1></div>
      <main>
        <h1 class="entry-title">Hello World</h1>
        <p>Some body text.</p>
      </main>
    </body></html>`,
    { url: "http://localhost/hello-world" },
  );
  for (const key of installedGlobals) {
    savedGlobals[key] = untypedGlobal[key];
    untypedGlobal[key] = (dom.window as unknown as Record<string, unknown>)[key];
  }
  // jsdom implements neither `scrollIntoView` nor `matchMedia` — stubbed per own. See docs/decisions/DR-001-single-shot-page-actions.md.
  // acceptance-criteria note that this is a layout-free DOM, not a real browser.
  dom.window.Element.prototype.scrollIntoView = () => {};
  dom.window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  actions = createBrowserPageActions({ root: document, selection,
    allowPath: ({ path }) => path.startsWith('/') && !path.startsWith('//'), navigate: () => {},
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    scroll: ({ element, options }) => element.scrollIntoView(options),
    timers: { schedule: ({ callback, delayMs }) => setTimeout(callback, delayMs), cancel: ({ handle }) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    highlightClass: 'example-widget__highlight', fadeAnimationName: 'example-widget-highlight-fade', cleanupFallbackMs: 21_000,
  });
});

afterEach(() => {
  clearHighlight();
  for (const key of installedGlobals) untypedGlobal[key] = savedGlobals[key];
  dom.window.close();
  vi.useRealTimers();
});

describe("findTargetElement", () => {
  it("finds the exact-text-match heading", () => {
    const found = findTargetElement("Hello World");
    assert.equal(found?.tagName, "H1");
    assert.equal(found?.className, "entry-title");
  });

  it("falls back to a case-insensitive match", () => {
    const found = findTargetElement("HELLO WORLD");
    assert.equal(found?.className, "entry-title");
  });

  it("returns null when nothing matches", () => {
    assert.equal(findTargetElement("No Such Title"), null);
  });

  it("returns null for an empty or whitespace-only title", () => {
    assert.equal(findTargetElement(""), null);
    assert.equal(findTargetElement("   "), null);
  });

  it("never returns an element inside the widget's own pane (SPEC-046 §4)", () => {
    // The widget's own heading text ("Ask this site") must never be a valid highlight target, even
    // if a post happened to be titled that.
    assert.equal(findTargetElement("Ask this site"), null);
  });

  it("accepts an explicit root, scoping the search below it", () => {
    const main = document.querySelector("main");
    assert.ok(main);
    const inside = main.querySelector(".entry-title");
    const outside = document.createElement("h2");
    outside.textContent = "Hello World";
    document.body.prepend(outside);
    assert.equal(findTargetElement("Hello World", main), inside);
    outside.textContent = "Outside only";
    assert.equal(findTargetElement("Outside only", main), null);
  });
  it("prefers an exact title-class match over an earlier case-insensitive heading", () => {
    const heading = document.querySelector(".entry-title")!;
    heading.textContent = "HELLO WORLD";
    const exact = document.createElement("div");
    exact.className = "custom-title";
    exact.textContent = "Hello World";
    document.querySelector("main")!.append(exact);
    assert.equal(findTargetElement("Hello World"), exact);
  });

});

describe("applyHighlight / clearHighlight", () => {
  it("adds the highlight class to the target element", () => {
    const el = document.querySelector(".entry-title") as Element;
    applyHighlight(el);
    assert.ok(el.classList.contains("example-widget__highlight"));
  });

  it("clearHighlight removes the class and is idempotent", () => {
    const el = document.querySelector(".entry-title") as Element;
    applyHighlight(el);
    clearHighlight();
    assert.ok(!el.classList.contains("example-widget__highlight"));
    assert.doesNotThrow(() => clearHighlight());
  });

  it("only one element is highlighted at a time — a second apply clears the first", () => {
    const first = document.querySelector(".entry-title") as Element;
    const second = document.querySelector("p") as Element;
    applyHighlight(first);
    applyHighlight(second);
    assert.ok(!first.classList.contains("example-widget__highlight"));
    assert.ok(second.classList.contains("example-widget__highlight"));
  });

  it("re-applying to the already-highlighted element is a no-op, not a restart", () => {
    vi.useFakeTimers();
    const el = document.querySelector(".entry-title") as Element;
    const observer = new dom.window.MutationObserver(() => {});
    try {
      applyHighlight(el);
      vi.advanceTimersByTime(10_000);
      observer.observe(el, { attributes: true, attributeFilter: ["class"] });
      applyHighlight(el);
      assert.deepEqual(observer.takeRecords(), [], "redundant apply must not remove/re-add the class");
      assert.ok(el.classList.contains("example-widget__highlight"), "still highlighted after a redundant apply");
      vi.advanceTimersByTime(10_999);
      assert.ok(el.classList.contains("example-widget__highlight"));
      vi.advanceTimersByTime(1);
      assert.ok(!el.classList.contains("example-widget__highlight"), "expires at the original deadline");
    } finally {
      observer.disconnect();
      clearHighlight();
    }
  });

  it("clears at the 21s fallback deadline when no animationend arrives", () => {
    vi.useFakeTimers();
    const el = document.querySelector(".entry-title")!;
    try {
      applyHighlight(el);
      vi.advanceTimersByTime(20_999);
      assert.ok(el.classList.contains("example-widget__highlight"));
      vi.advanceTimersByTime(1);
      assert.ok(!el.classList.contains("example-widget__highlight"));
    } finally { clearHighlight(); }
  });

  it("cancels the old fallback so it cannot clear a newer highlight", () => {
    vi.useFakeTimers();
    const first = document.querySelector(".entry-title")!;
    const second = document.querySelector("p")!;
    try {
      applyHighlight(first);
      vi.advanceTimersByTime(10_000);
      applyHighlight(second);
      vi.advanceTimersByTime(11_000);
      assert.ok(!first.classList.contains("example-widget__highlight"));
      assert.ok(second.classList.contains("example-widget__highlight"), "old deadline must not clear the new target");
      vi.advanceTimersByTime(10_000);
      assert.ok(!second.classList.contains("example-widget__highlight"));
    } finally { clearHighlight(); }
  });

  it("clears on the FADE animation's animationend, ignoring an earlier pulse animationend", () => {
    const el = document.querySelector(".entry-title") as Element;
    applyHighlight(el);

    const pulseEnd = new dom.window.Event("animationend") as AnimationEvent & { animationName?: string };
    Object.defineProperty(pulseEnd, "animationName", { value: "example-widget-highlight-pulse" });
    el.dispatchEvent(pulseEnd);
    assert.ok(el.classList.contains("example-widget__highlight"), "the pulse ending must not clear the highlight");

    const fadeEnd = new dom.window.Event("animationend") as AnimationEvent & { animationName?: string };
    Object.defineProperty(fadeEnd, "animationName", { value: "example-widget-highlight-fade" });
    el.dispatchEvent(fadeEnd);
    assert.ok(!el.classList.contains("example-widget__highlight"), "the fade ending must clear the highlight");
  });
});

describe("scrollToElement", () => {
  it("scrolls smoothly when the visitor has no reduced-motion preference", () => {
    const el = document.querySelector(".entry-title") as Element;
    let seenOptions: ScrollIntoViewOptions | undefined;
    el.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => {
      seenOptions = options as ScrollIntoViewOptions;
    };
    scrollToElement(el);
    assert.equal(seenOptions?.behavior, "smooth");
  });

  it("scrolls without smooth animation under prefers-reduced-motion: reduce", () => {
    dom.window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    const el = document.querySelector(".entry-title") as Element;
    let seenOptions: ScrollIntoViewOptions | undefined;
    el.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => {
      seenOptions = options as ScrollIntoViewOptions;
    };
    scrollToElement(el);
    assert.equal(seenOptions?.behavior, "auto");
  });
});

describe('page action policy and instance lifecycle', () => {
  it('denies paths before any navigation or DOM treatment', () => {
    const target = { slug: 'x', title: 'Hello World', path: '//outside.example' };
    assert.equal(actions.allows({ action: { type: 'navigate', auto: true, target } }), false);
    assert.equal(actions.navigate({ action: { type: 'navigate', auto: true, target } }), false);
    assert.equal(actions.execute({ action: { type: 'highlight', target } }), false);
    assert.equal(document.querySelector('.entry-title')!.classList.contains('example-widget__highlight'), false);
  });
  it('fails softly on a missing target and highlights a resolved target', () => {
    assert.equal(actions.execute({ action: { type: 'highlight', target: { slug: 'x', title: 'missing', path: '/x' } } }), false);
    assert.equal(actions.execute({ action: { type: 'highlight', target: { slug: 'x', title: 'Hello World', path: '/x' } } }), true);
    assert.equal(document.querySelector('.entry-title')!.classList.contains('example-widget__highlight'), true);
    assert.equal(actions.navigate({ action: { type: 'navigate', auto: false, target: { slug: 'x', title: 'X', path: '/x' } } }), true);
    assert.equal(document.querySelector('.entry-title')!.classList.contains('example-widget__highlight'), false);
  });
  it('ignores a descendant fade event and cleans only its own target fade', () => {
    const el = document.querySelector('.entry-title')!;
    const child = document.createElement('span');
    el.append(child);
    applyHighlight(el);
    const event = new Event('animationend', { bubbles: true });
    Object.defineProperty(event, 'animationName', { value: 'example-widget-highlight-fade' });
    child.dispatchEvent(event);
    assert.equal(el.classList.contains('example-widget__highlight'), true);
    el.dispatchEvent(event);
    assert.equal(el.classList.contains('example-widget__highlight'), false);
  });
  it('ignores a stale canceled timeout even if the host delivers it late', () => {
    const callbacks: (() => void)[] = [];
    const isolated = createBrowserPageActions({ root: document, selection, allowPath: () => true, navigate: () => {}, reducedMotion: () => false,
      scroll: () => {}, highlightClass: 'isolated-highlight', fadeAnimationName: 'fade', cleanupFallbackMs: 21_000,
      timers: { schedule: ({ callback }) => { callbacks.push(callback); return callbacks.length; }, cancel: () => {} } });
    const first = document.querySelector('h1.entry-title')!;
    const second = document.querySelector('p')!;
    isolated.applyHighlight({ element: first });
    isolated.applyHighlight({ element: second });
    callbacks[0]!();
    assert.equal(second.classList.contains('isolated-highlight'), true);
    callbacks[1]!();
    assert.equal(second.classList.contains('isolated-highlight'), false);
  });
  it('does not clear another controller instance highlight', () => {
    const isolated = createBrowserPageActions({ root: document, selection, allowPath: () => true, navigate: () => {}, reducedMotion: () => false,
      scroll: () => {}, highlightClass: 'isolated-highlight', fadeAnimationName: 'fade', cleanupFallbackMs: 21_000,
      timers: { schedule: () => 1, cancel: () => {} } });
    const first = document.querySelector('h1.entry-title')!;
    const second = document.querySelector('p')!;
    isolated.applyHighlight({ element: first });
    applyHighlight(second);
    clearHighlight();
    assert.equal(first.classList.contains('isolated-highlight'), true);
    isolated.clearHighlight({});
    assert.equal(first.classList.contains('isolated-highlight'), false);
  });
});
