/**
 * @file Coverage for `use-site-preview.hooks.ts`'s pure decision logic. Every decision the
 * `useSitePreview` effect makes is a plain function it calls — `previewFetchPlan` (whether to
 * clear, skip, or fetch) and `nextPreviewUrl` (what a settled fetch should write, respecting
 * cancellation) — pulled out so their decisions can be tested without a renderer. Both are tested here directly, with real inputs and
 * exact expected outputs. The effect itself — refetching per id and version, and a superseded
 * request's late reply or failure never clobbering a newer one — is rendered from the real module
 * in `use-site-preview.hooks.render.test.tsx`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { nextPreviewUrl, previewFetchPlan, type SitePreviewBridge } from "../use-site-preview.hooks.js";

// ---------------------------------------------------------------------------------------------
// previewFetchPlan
// ---------------------------------------------------------------------------------------------

test("a null previewVersion clears, even when a bridge IS available", () => {
  // Regression: if the bridge check ran first, a site with a live bridge but no capture for this
  // version would fall through to fetching instead of clearing — checked with a present fake bridge
  // specifically so this test cannot pass merely because the bridge happened to be undefined too.
  const fakeBridge = {} as unknown as SitePreviewBridge;
  assert.deepEqual(previewFetchPlan({ id: "site-1", previewVersion: null, bridge: fakeBridge }), { kind: "clear" });
});

test("a null previewVersion clears with no bridge either", () => {
  assert.deepEqual(previewFetchPlan({ id: "site-1", previewVersion: null, bridge: undefined }), { kind: "clear" });
});

test("a real previewVersion with no bridge skips — no fetch attempted, but nothing is cleared", () => {
  assert.deepEqual(previewFetchPlan({ id: "site-1", previewVersion: 42, bridge: undefined }), { kind: "skip" });
});

test("a real previewVersion with a bridge plans a fetch, carrying that SAME bridge reference and the id", () => {
  const fakeBridge = {} as unknown as SitePreviewBridge;
  const plan = previewFetchPlan({ id: "site-7", previewVersion: 42, bridge: fakeBridge });
  assert.equal(plan.kind, "fetch");
  if (plan.kind !== "fetch") throw new Error("unreachable — asserted above");
  assert.equal(plan.bridge, fakeBridge, "must be the SAME bridge, not a copy");
  assert.equal(plan.id, "site-7");
});

test("previewVersion 0 is a real version, not treated like null", () => {
  // A falsy-but-real value — the exact class of bug a `!previewVersion` check (instead of
  // `=== null`) would introduce.
  const fakeBridge = {} as unknown as SitePreviewBridge;
  assert.deepEqual(previewFetchPlan({ id: "site-1", previewVersion: 0, bridge: fakeBridge }), { kind: "fetch", bridge: fakeBridge, id: "site-1" });
});

// ---------------------------------------------------------------------------------------------
// nextPreviewUrl
// ---------------------------------------------------------------------------------------------

test("a cancelled run writes nothing on success — a stale resolve must not clobber a newer run", () => {
  assert.equal(nextPreviewUrl({ cancelled: true, outcome: { ok: true, url: "data:image/png;base64,fake" } }), undefined);
});

test("a cancelled run writes nothing on failure either", () => {
  assert.equal(nextPreviewUrl({ cancelled: true, outcome: { ok: false } }), undefined);
});

test("a live run writes the resolved url on success", () => {
  assert.equal(nextPreviewUrl({ cancelled: false, outcome: { ok: true, url: "data:image/png;base64,fake" } }), "data:image/png;base64,fake");
});

test("a live run writes null on success when there genuinely is no capture yet", () => {
  // `getSitePreview` resolving `null` is not a failure — it is "nothing captured yet" — and must
  // still be written (as null), not treated the same as "do nothing" the way a cancelled run is.
  assert.equal(nextPreviewUrl({ cancelled: false, outcome: { ok: true, url: null } }), null);
});

test("a live run writes null on failure", () => {
  assert.equal(nextPreviewUrl({ cancelled: false, outcome: { ok: false } }), null);
});
