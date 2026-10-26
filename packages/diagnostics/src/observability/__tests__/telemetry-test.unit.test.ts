import { expect, it } from "vitest";
import { createTelemetryTestProbe } from "../telemetry-test.js";
import { createTracker } from "../tracker.js";
import { createNoopObservabilityPort } from "../noop.js";
import { fanOutProductAnalytics, withProductAnalyticsGuards } from "@jini-ai/analytics/product";
import type { ErrorReport } from "../ports.js";

it("waits for delayed consent admission before returning analytics receipts", async () => {
  const probe = createTelemetryTestProbe({});
  let decide!: (allowed: boolean) => void;
  const decision = new Promise<boolean>(resolve => { decide = resolve; });
  let finished = false;
  const analytics = withProductAnalyticsGuards({ consent: () => decision, inner: {
    capture(input) { probe.accepted({ providerId: "analytics", method: "capture", input }); }, identify() {},
  } }, { consentRevision: () => 1 });
  const tracker = createTracker({ productAnalytics: fanOutProductAnalytics({ ports: [analytics] }) });
  const pending = probe.send({ tracker, userId: "site:test", error: new Error("Diagnostic") }).then(result => { finished = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  expect(finished).toBe(false);
  decide(true);
  expect(await pending).toEqual({ providers: [{ providerId: "analytics", signals: ["analytics"] }] });
});

it("sends exactly one diagnostic per signal through the facade, with local acceptance and consent", async () => {
  const probe = createTelemetryTestProbe({});
  const reports: ErrorReport[] = [];
  const spans: string[] = [];
  const events: string[] = [];
  let consent = false;
  const tracker = createTracker({
    observability: { ...createNoopObservabilityPort({}),
      trackOperation(input) { spans.push(input.name); probe.accepted({ providerId: "traces", method: "trackOperation", input }); return { run: fn => fn(), end() {} }; },
      reportError(input) { reports.push(input); probe.accepted({ providerId: "errors", method: "reportError", input }); },
    },
    productAnalytics: withProductAnalyticsGuards({ consent: () => consent, inner: {
      capture(input) { events.push(input.name); probe.accepted({ providerId: "analytics", method: "capture", input }); }, identify() {},
    } }),
  });
  const send = () => probe.send({ tracker, userId: "site:test", error: new Error("Diagnostic — safe to ignore") });
  expect(await send()).toEqual({ providers: [{ providerId: "traces", signals: ["span"] }, { providerId: "errors", signals: ["error"] }] });
  expect(events).toEqual([]);
  consent = true;
  expect(await send()).toEqual({ providers: [{ providerId: "traces", signals: ["span"] }, { providerId: "errors", signals: ["error"] }, { providerId: "analytics", signals: ["analytics"] }] });
  expect(spans).toEqual(["telemetry.test", "telemetry.test"]);
  expect(events).toEqual(["telemetry_test"]);
  expect(reports.map(report => (report.error as Error).message)).toEqual(["Diagnostic — safe to ignore", "Diagnostic — safe to ignore"]);
  expect(reports.map(report => report.context)).toEqual([{ operation: "telemetry.test" }, { operation: "telemetry.test" }]);
  probe.accepted({ providerId: "outside", method: "capture", input: { name: "telemetry_test" } });
  expect(await probe.send({ tracker: createTracker({}), userId: "site:test", error: new Error("Diagnostic") })).toEqual({ providers: [] });
});

it("isolates simultaneous diagnostic scopes", async () => {
  const probe = createTelemetryTestProbe({});
  const trackerFor = (providerId: string) => createTracker({ observability: {
    ...createNoopObservabilityPort({}), reportError(input) { probe.accepted({ providerId, method: "reportError", input }); },
  } });
  const results = await Promise.all(["a", "b"].map(providerId => probe.send({ tracker: trackerFor(providerId), userId: "site:test", error: new Error("Diagnostic") })));
  expect(results).toEqual([{ providers: [{ providerId: "a", signals: ["error"] }] }, { providers: [{ providerId: "b", signals: ["error"] }] }]);
});
