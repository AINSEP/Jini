/** Product analytics: the guard rules. The PostHog provider's SDK tests live with its plugin (`@jini-ai/provider-plugins`). */
import { expect, test } from "vitest";

import { createNoopProductAnalytics, fanOutProductAnalytics, isNoopProductAnalytics, withProductAnalyticsGuards, type BrowserAnalyticsContribution, type ProductEvent, type ProductAnalyticsPort } from "../product/index.js";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function recordingPort(): { port: ProductAnalyticsPort; events: ProductEvent[] } {
  const events: ProductEvent[] = [];
  return { events, port: { capture: (event) => { events.push(event); }, identify: () => {} } };
}

test("P21: guards and single-provider fanout preserve browser contributions for each surface", () => {
  const contributions: Record<"site" | "admin", BrowserAnalyticsContribution> = {
    site: { source: "function(){return function(mode){window.siteMode=mode;};}", origins: [], supportsStatic: true },
    admin: { source: "function(){return function(mode){window.adminMode=mode;};}", origins: [], supportsStatic: false },
  };
  const { port } = recordingPort();
  const inner: ProductAnalyticsPort = {
    ...port,
    browserAnalytics: ({ surface }) => contributions[surface],
  };
  const guarded = withProductAnalyticsGuards({ inner, consent: () => true });
  const fanout = fanOutProductAnalytics({ ports: [inner] });

  for (const surface of ["site", "admin"] as const) {
    // Soft assertions expose both losses independently in this single finding's test.
    expect.soft(guarded.browserAnalytics?.({ surface }), `guard: ${surface}`).toEqual(contributions[surface]);
    expect.soft(fanout.browserAnalytics?.({ surface }), `fanout: ${surface}`).toEqual(contributions[surface]);
  }
});

test("noop: one shared frozen port, and the guard keeps it as-is (zero cost when unconfigured)", () => {
  const noop = createNoopProductAnalytics({});
  expect(isNoopProductAnalytics(noop)).toBe(true);
  expect(Object.isFrozen(noop)).toBe(true);
  expect(withProductAnalyticsGuards({ inner: noop, consent: () => true })).toBe(noop);
});

test("consent gates every event, checked per event (a revoked consent stops the next one)", () => {
  const { port, events } = recordingPort();
  let consented = true;
  const guarded = withProductAnalyticsGuards({ inner: port, consent: () => consented });
  guarded.capture({ name: "assistant_tool_call", userId: "u1" });
  consented = false;
  guarded.capture({ name: "assistant_tool_call", userId: "u1" });
  expect(events.map((e) => e.userId)).toEqual(["u1"]);
});

test("PII and secrets: e-mail ids, PII-named keys, e-mail values, bad names are dropped; secret values redacted", () => {
  const { port, events } = recordingPort();
  const guarded = withProductAnalyticsGuards({ inner: port, consent: () => true });
  guarded.capture({ name: "assistant_tool_call", userId: "owner@example.com" });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { email: "x" } });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { note: "mail me at a@b.co" } });
  guarded.capture({ name: "Free text the user typed", userId: "u1" });
  guarded.capture({ name: "assistant_tool_call", userId: SECRET });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { tool_id: SECRET, ok: true } });
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(SECRET);
  expect(events[0]?.properties?.ok).toBe(true);
});

test("a throwing consent check or vendor never fails the feature", () => {
  const broken = withProductAnalyticsGuards({ inner: { capture: () => { throw new Error("down"); }, identify: () => { throw new Error("down"); } }, consent: () => true });
  expect(() => broken.capture({ name: "x", userId: "u1" })).not.toThrow();
  expect(() => broken.identify({ userId: "u1" })).not.toThrow();
  const { port, events } = recordingPort();
  withProductAnalyticsGuards({ inner: port, consent: () => { throw new Error("settings down"); } }).capture({ name: "x", userId: "u1" });
  expect(events).toEqual([]);
});

test("an async consent (a settings read) delays the event until it answers true; false or a rejection drops it", async () => {
  const { port, events } = recordingPort();
  const answers = [Promise.resolve(true), Promise.resolve(false), Promise.reject(new Error("db down"))];
  const guarded = withProductAnalyticsGuards({ inner: port, consent: () => answers.shift()! }, { consentRevision: () => 1 });
  for (const userId of ["u1", "u2", "u3"]) guarded.capture({ name: "assistant_tool_call", userId });
  expect(events).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events.map((e) => e.userId)).toEqual(["u1"]);
});
