import { expect, it, vi } from "vitest";
import { analyticsProof, collectorDecision, matchConsentPluginHttp, readVisitorConsent, receiptAllowsAnalytics } from "../http.js";
import { readConsent } from "../../server/index.js";
import { CONSENT_COOKIE } from "../../contract.js";
import type { ConsentConfig } from "@jini-ai/core/contracts/site/cookie-consent";

const config: ConsentConfig = { enabled: true, regionMode: "opt-in", policyVersion: "p", privacyPolicyUrl: "/privacy", title: "", message: "", acceptLabel: "", rejectLabel: "", preferencesLabel: "" };

it("refuses a collector before rate or handler work and refuses a retired receipt at delivery", async () => {
  const rateAllowed = vi.fn(async () => true);
  const state = readConsent({ cookieHeader: "", policy: "p", regionMode: "opt-in" });
  expect(await collectorDecision({ origin: "https://site", siteOrigin: () => "https://site", adapter: { category: "analytics" }, readState: async () => state, rateAllowed })).toEqual({ status: 403, analyticsLevel: "none" });
  expect(rateAllowed).not.toHaveBeenCalled();
  const readReceipt = vi.fn(async () => null);
  expect(await receiptAllowsAnalytics({ proof: { receiptId: "retired", policyVersion: "p" }, readSnapshot: async () => config, snapshotUnavailable: () => false, readPolicyVersion: async () => "p", readReceipt, nowMs: () => 1000 })).toBe(false);
  expect(readReceipt).toHaveBeenCalledWith({ id: "retired" });
});

it("requires anonymous support when the published banner is off without reading fallback policy", async () => {
  const readPolicy = vi.fn(async () => config);
  const state = await readVisitorConsent({ readSnapshot: async () => ({ ...config, enabled: false }), snapshotUnavailable: () => false, readPolicy, facts: () => ({ cookieHeader: "bad", nowMs: 1000 }) });
  expect(state.analyticsLevel).toBe("anonymous");
  expect(readPolicy).not.toHaveBeenCalled();
  for (const supportsAnonymous of [false, true]) {
    expect((await collectorDecision({ origin: "site", siteOrigin: () => "site", adapter: { category: "analytics", supportsAnonymous }, readState: async () => state, rateAllowed: async () => true })).status).toBe(supportsAnonymous ? null : 403);
  }
  expect((await collectorDecision({ origin: "site", siteOrigin: () => "site", adapter: { category: "necessary" }, readState: async () => state, rateAllowed: async () => true })).status).toBe(403);
});

it("rejects invalid cookie encoding and stale policy before receipt I/O", async () => {
  const state = { ...readConsent({ cookieHeader: "", policy: "p", regionMode: "opt-in" }), analyticsLevel: "full" as const };
  expect(analyticsProof({ state, cookieHeader: `${CONSENT_COOKIE}=%E0%A4%A` })).toBeUndefined();
  const readReceipt = vi.fn(async () => null);
  expect(await receiptAllowsAnalytics({ proof: { receiptId: "id", policyVersion: "old" }, readSnapshot: async () => config, snapshotUnavailable: () => false, readPolicyVersion: async () => "p", readReceipt, nowMs: () => 0 })).toBe(false);
  expect(readReceipt).not.toHaveBeenCalled();
});

it("rejects unsafe plugin paths without adapter enumeration", () => {
  const plugins = vi.fn(() => []);
  for (const full of ["/_consent/p/../x", "/_consent/p/%2f", "/_consent/p/\\x"]) expect(matchConsentPluginHttp({ full, plugins })).toBeUndefined();
  expect(plugins).not.toHaveBeenCalled();
});
