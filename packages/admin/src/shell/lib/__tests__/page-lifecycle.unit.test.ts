// @vitest-environment jsdom
import { expect, it } from "vitest";

import { createPageLifecycle, isPageUnloading } from "../page-lifecycle.js";

/**
 * @file The browser half of `page-lifecycle.ts` (the non-browser import is
 * `page-lifecycle.node.unit.test.ts`): the listeners installed at import flip the unloading fact on
 * `pagehide` and clear it on `pageshow`, so a page restored from the back/forward cache reports real
 * request failures again.
 */
it("reports unloading from pagehide until the next pageshow (bfcache restore)", () => {
  expect(isPageUnloading()).toBe(false);
  window.dispatchEvent(new Event("pagehide"));
  expect(isPageUnloading()).toBe(true);
  expect(isPageUnloading()).toBe(true);
  window.dispatchEvent(new Event("pageshow"));
  expect(isPageUnloading()).toBe(false);
});

it("with no page to listen to (a non-browser host) never reports unloading", () => {
  const lifecycle = createPageLifecycle({ target: undefined });
  expect(lifecycle.isPageUnloading()).toBe(false);
  window.dispatchEvent(new Event("pagehide"));
  expect(lifecycle.isPageUnloading()).toBe(false);
  window.dispatchEvent(new Event("pageshow"));
});

it("each lifecycle follows only its own page's events", () => {
  const page = new EventTarget();
  const lifecycle = createPageLifecycle({ target: page });
  page.dispatchEvent(new Event("pagehide"));
  expect(lifecycle.isPageUnloading()).toBe(true);
  expect(isPageUnloading()).toBe(false);
  page.dispatchEvent(new Event("pageshow"));
  expect(lifecycle.isPageUnloading()).toBe(false);
});
