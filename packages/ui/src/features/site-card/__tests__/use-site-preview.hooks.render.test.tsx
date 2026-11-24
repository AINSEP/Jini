// @vitest-environment jsdom
/**
 * @file `useSitePreview` rendered from its real module under jsdom, with the bridge injected through
 * its `getBridge` port. The plan/next-url decisions have direct tests in
 * `use-site-preview.hooks.unit.test.ts`; this file asserts the effect: fetch per version, clear on a
 * null version, keep nothing on failure, and never let a stale reply clobber a newer one.
 */
import assert from "node:assert/strict";
import { act, renderHook as render } from "@testing-library/react";
import { test } from "vitest";

import { useSitePreview, type SitePreviewBridge } from "../use-site-preview.hooks.js";

/** The `current()` / `rerender()` handle these cases were written against. */
function renderHook<T>(useHook: () => T) {
  const view = render(useHook);
  return { current: () => view.result.current, rerender: () => view.rerender() };
}

/** Let pending promise callbacks and the React updates they schedule run. */
async function settle() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

/** A bridge whose `getSitePreview` calls stay pending until the test settles them. */
function previewBridge() {
  const asked: string[] = [];
  const pending: { resolve: (url: string | null) => void; reject: (error: unknown) => void }[] = [];
  const bridge: SitePreviewBridge = {
    getSitePreview: ({ id }) => {
      asked.push(id);
      return new Promise<string | null>((resolve, reject) => { pending.push({ resolve, reject }); });
    },
  };
  const getBridge = () => bridge;
  return { getBridge, asked, next: () => pending.shift()! };
}

test("a version fetches its capture once; a null version clears what was shown", async () => {
  const fake = previewBridge();
  let version: number | null = 1;
  const hook = renderHook(() => useSitePreview({ id: "/sites/a", previewVersion: version, getBridge: fake.getBridge }));
  assert.equal(hook.current(), null, "nothing until the fetch resolves");
  fake.next().resolve("file:///previews/a-1.png");
  await settle();
  assert.equal(hook.current(), "file:///previews/a-1.png");
  hook.rerender();
  assert.deepEqual(fake.asked, ["/sites/a"], "a rerender with the same version does not refetch");
  version = null;
  hook.rerender();
  await settle();
  assert.equal(hook.current(), null);
});

test("a failed fetch renders no image", async () => {
  const fake = previewBridge();
  const hook = renderHook(() => useSitePreview({ id: "/sites/a", previewVersion: 3, getBridge: fake.getBridge }));
  fake.next().reject(new Error("capture unreadable"));
  await settle();
  assert.equal(hook.current(), null);
});

test("a reply or failure from a superseded version never overwrites the newer one", async () => {
  const fake = previewBridge();
  let version = 1;
  const hook = renderHook(() => useSitePreview({ id: "/sites/a", previewVersion: version, getBridge: fake.getBridge }));
  const first = fake.next();
  version = 2;
  hook.rerender();
  const second = fake.next();
  version = 3;
  hook.rerender();
  const third = fake.next();
  third.resolve("file:///previews/a-3.png");
  await settle();
  first.resolve("file:///previews/a-1.png");
  second.reject(new Error("late failure"));
  await settle();
  assert.equal(hook.current(), "file:///previews/a-3.png");
});

test("with no bridge there is nothing to ask, so nothing is shown", async () => {
  const getBridge = () => undefined;
  const hook = renderHook(() => useSitePreview({ id: "/sites/a", previewVersion: 1, getBridge }));
  await settle();
  assert.equal(hook.current(), null);
});

test("two sites that share a version number each fetch their own capture", async () => {
  // Regression: if the dependency array narrowed to `[previewVersion]` alone, two different sites
  // sharing a version number (a filesystem mtime, which need not be monotonic) would keep showing
  // whichever site fetched first. Render the hook to observe the id-change refetch directly;
  // keep the injected `getBridge` port stable so only the id change can trigger it.
  const fake = previewBridge();
  let id = "/sites/a";
  const hook = renderHook(() => useSitePreview({ id, previewVersion: 7, getBridge: fake.getBridge }));
  fake.next().resolve("file:///previews/a-7.png");
  await settle();
  id = "/sites/b";
  hook.rerender();
  fake.next().resolve("file:///previews/b-7.png");
  await settle();
  assert.deepEqual(fake.asked, ["/sites/a", "/sites/b"]);
  assert.equal(hook.current(), "file:///previews/b-7.png");
});
