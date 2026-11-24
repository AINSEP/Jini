import { expect, expectTypeOf, test } from "vitest";

import type { BrowserAnalyticsSource, VisitorAnalyticsDeps } from "../contracts.js";

/**
 * @file Characterization of the analytics host contracts moved from the host: every visitor port is
 * optional (a missing consent proof or id generator denies capture rather than failing), and the
 * browser source is keyed by surface.
 */

test("VisitorAnalyticsDeps accepts an empty object: every capture port is optional", () => {
  const none: VisitorAnalyticsDeps = {};
  expect(Object.keys(none)).toEqual([]);
  expectTypeOf<VisitorAnalyticsDeps["visitorAnalyticsProof"]>().toEqualTypeOf<
    ((required: { request: unknown }) => Promise<{ receiptId: string; policyVersion: string } | undefined>) | undefined
  >();
});

test("BrowserAnalyticsSource is called per surface and returns contributions", () => {
  const seen: string[] = [];
  const source: BrowserAnalyticsSource = ({ surface }) => { seen.push(surface); return []; };
  expect(source({ surface: "site" })).toEqual([]);
  expect(source({ surface: "admin" })).toEqual([]);
  expect(seen).toEqual(["site", "admin"]);
});
