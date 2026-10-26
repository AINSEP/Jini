import { describe, expect, it } from "vitest";
import { withProductAnalyticsGuards, type ProductEvent } from "@jini-ai/analytics/product";
import { combineObservabilityPorts } from "../fanout.js";
import { createNoopTracker } from "../tracker-noop.js";
import { createTracker } from "../tracker.js";
import { createNoopObservabilityPort } from "../noop.js";
import { runWithErrorReportScope } from "../report-error.js";
import type { ErrorReport, ObservabilityPort } from "../ports.js";

const WARNING = "[tracker] a telemetry provider failed; application work continues";
const event: ProductEvent = { name: "post_created", userId: "principal-1" };

/** DI fakes only: exercise facade behavior through the existing provider contracts. */
describe("one tracker facade", () => {
  it("without providers, all methods are safe and trace returns the callback result exactly once", async () => {
    const tracker = createTracker({});
    let calls = 0;
    tracker.capture({ name: event.name, userId: event.userId });
    tracker.error({ error: new Error("expected") });
    tracker.metric({ name: "queue.size", value: 1 });
    const result = { id: "result" };
    expect(await tracker.trace({ name: "deploy", run: () => { calls++; return result; } })).toBe(result);
    expect(calls).toBe(1);
  });

  it("analytics alone keeps consent per event and does not require a tracing provider", async () => {
    let allowed = false;
    const events: ProductEvent[] = [];
    const productAnalytics = withProductAnalyticsGuards({ inner: { capture: (value) => { events.push(value); }, identify() {} }, consent: () => allowed });
    const tracker = createTracker({ productAnalytics });
    tracker.capture({ name: event.name, userId: event.userId });
    allowed = true;
    tracker.capture({ name: event.name, userId: event.userId });
    tracker.error({ error: new Error("incident") });
    expect(await tracker.trace({ name: "deploy", run: async () => 42 })).toBe(42);
    expect(events).toEqual([event]);
  });

  it("reuses pending-consent revocation and never sends an old approval", async () => {
    let approve!: (allowed: boolean) => void;
    let revision = 1;
    const events: ProductEvent[] = [];
    const productAnalytics = withProductAnalyticsGuards({ inner: { capture: (value) => { events.push(value); }, identify() {} },
      consent: () => new Promise<boolean>((resolve) => { approve = resolve; }) }, { consentRevision: () => revision });
    const tracker = createTracker({ productAnalytics });
    tracker.capture({ name: event.name, userId: event.userId });
    revision++;
    approve(true);
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it("observability alone records redacted errors once and marks the current request scope", () => {
    const reports: ErrorReport[] = [];
    const observability: ObservabilityPort = { ...createNoopObservabilityPort({}), reportError: (report) => { reports.push(report); } };
    const tracker = createTracker({ observability });
    // A fake secret is constructed at runtime; exact matching also covers unrecognized shapes.
    const secret = ["private", "fixture", "value"].join("-");
    const failure = new Error(`refused ${secret}`);
    const scope = { reported: false };
    runWithErrorReportScope({ scope, work: () => tracker.error({ error: failure }, { context: { route: "/posts/:id", exactSecrets: [secret] } }) });
    tracker.error({ error: failure });
    tracker.capture({ name: event.name, userId: event.userId });
    expect(scope.reported).toBe(true);
    expect(reports).toHaveLength(1);
    expect((reports[0]!.error as Error).message).toBe("refused [REDACTED:exact_secret]");
    expect(reports[0]!.context).toEqual({ operation: "application.error", attributes: { route: "/posts/:id" } });
  });

  it("isolates failing providers and a failing warning sink, emitting one fixed diagnostic", async () => {
    const warnings: string[] = [];
    const unavailable = () => { throw new Error("provider configuration detail"); };
    const observability: ObservabilityPort = { ...createNoopObservabilityPort({}), reportError: unavailable, trackOperation: unavailable };
    const tracker = createTracker({ observability, productAnalytics: { capture: unavailable, identify() {} } }, {
      warn: (message) => { warnings.push(message); throw new Error("logger unavailable"); },
    });
    tracker.capture({ name: event.name, userId: event.userId });
    tracker.capture({ name: event.name, userId: event.userId });
    tracker.error({ error: new Error("application failure") });
    expect(await tracker.trace({ name: "deploy", run: async () => "published" })).toBe("published");
    expect(warnings).toEqual([WARNING]);
  });

  it("observes rejected background delivery without exposing provider details", async () => {
    const warnings: string[] = [];
    const tracker = createTracker({ productAnalytics: { capture: () => Promise.reject(new Error("provider detail")), identify() {} } }, { warn: (message) => { warnings.push(message); } });
    tracker.capture({ name: event.name, userId: event.userId });
    await Promise.resolve();
    expect(warnings).toEqual([WARNING]);
  });

  for (const mode of ["before", "after", "twice", "skip", "replace"] as const) {
    it(`contains a provider scope that ${mode} mishandles work; callback runs once`, async () => {
      let calls = 0;
      const observability: ObservabilityPort = { ...createNoopObservabilityPort({}), trackOperation: () => ({
        run<T>(fn: () => T): T {
          if (mode === "before") throw new Error("before");
          if (mode === "skip") return "substitute" as T;
          const result = fn();
          if (mode === "after") throw new Error("after");
          if (mode === "twice") fn();
          return mode === "replace" ? "substitute" as T : result;
        },
        end() { throw new Error("settling provider failed"); },
      }) };
      const warnings: string[] = [];
      const tracker = createTracker({ observability }, { warn: (message) => { warnings.push(message); } });
      expect(await tracker.trace({ name: "deploy", run: async () => { calls++; return "application result"; } })).toBe("application result");
      expect(calls).toBe(1);
      expect(warnings).toEqual([WARNING]);
    });
  }

  for (const invalid of [null, {}, { end() {}, run: "invalid" }]) {
    it("contains an invalid provider lifecycle and still runs application work", async () => {
      const warnings: string[] = [];
      const observability: ObservabilityPort = { ...createNoopObservabilityPort({}), trackOperation: () => invalid as never };
      const tracker = createTracker({ observability }, { warn: (message) => { warnings.push(message); } });
      expect(await tracker.trace({ name: "deploy", run: () => "published" })).toBe("published");
      expect(warnings).toEqual([WARNING]);
    });
  }

  it("propagates the application's original failure and reports once, without a provider warning", async () => {
    const reports: ErrorReport[] = [];
    const outcomes: unknown[] = [];
    const warnings: string[] = [];
    const observability: ObservabilityPort = { ...createNoopObservabilityPort({}),
      trackOperation: () => ({ run: (fn) => fn(), end: (outcome) => { outcomes.push(outcome); } }),
      reportError: (report) => { reports.push(report); },
    };
    const tracker = createTracker({ observability }, { warn: (message) => { warnings.push(message); } });
    const failure = new Error("publish failed");
    await expect(tracker.trace({ name: "site.publish", run: () => { throw failure; } })).rejects.toBe(failure);
    tracker.error({ error: failure });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.context.operation).toBe("site.publish");
    expect(outcomes).toEqual([{ outcome: "error", failed: true }]);
    expect(warnings).toEqual([]);
  });

  it("keeps request correlation and the response's mount-aware outcome on the existing request port", async () => {
    const starts: unknown[] = [], outcomes: unknown[] = [];
    const observability: ObservabilityPort = { ...createNoopObservabilityPort({}), trackRequest: (input, options) => {
      starts.push({ input, options });
      return { end: (outcome) => { outcomes.push(outcome); } };
    } };
    await createTracker({ observability }).trace({ name: "http.request", run: async (span) => {
      span.setOutcome({ statusCode: 201, routePattern: "/admin/posts/:id" });
      span.setOutcome({ statusCode: 500, routePattern: "unmatched" });
    } }, { request: { method: "POST", path: "/admin/posts/123", requestId: "request-1" } });
    expect(starts).toEqual([{ input: { method: "POST", path: "/admin/posts/123" }, options: { requestId: "request-1" } }]);
    expect(outcomes).toEqual([{ statusCode: 201, routePattern: "/admin/posts/:id" }]);
  });

  it("keeps agent-run identifiers and canceled outcomes on the existing agent port", async () => {
    const starts: unknown[] = [], outcomes: unknown[] = [];
    const observability: ObservabilityPort = { ...createNoopObservabilityPort({}), trackAgentRun: (input, options) => {
      starts.push({ input, options }); return { run: (fn) => fn(), end: (outcome) => { outcomes.push(outcome); } };
    } };
    await createTracker({ observability }).trace({ name: "assistant.run", run: async (span) => { span.setOutcome({ status: "canceled" }); } }, { agent: { runId: "run-1", conversationId: "chat-1", agentName: "agent-1" } });
    expect(starts).toEqual([{ input: { runId: "run-1" }, options: { conversationId: "chat-1", agentName: "agent-1" } }]);
    expect(outcomes).toEqual([{ status: "canceled" }]);
  });
});

it("separates required signal fields from optional properties, context and attributes", async () => {
  const events: ProductEvent[] = [], reports: ErrorReport[] = [], starts: unknown[] = [], metrics: unknown[] = [];
  const tracker = createTracker({
    productAnalytics: { capture(input) { events.push(input); }, identify() {} },
    observability: { ...createNoopObservabilityPort({}),
      reportError(input) { reports.push(input); },
      trackOperation(input) { starts.push(input); return { run: fn => fn(), end() {} }; },
      metric(input, options) { metrics.push({ input, options }); },
    },
  });
  await tracker.capture({ name: "created", userId: "owner" }, { properties: { source: "admin" } });
  tracker.error({ error: new Error("expected") }, { context: { operation: "create", attributes: { source: "admin" } } });
  expect(await tracker.trace({ name: "create", run: () => 42 }, { attributes: { source: "admin" } })).toBe(42);
  tracker.metric({ name: "queue.size", value: 3 }, { kind: "gauge", unit: "{item}", attributes: { queue: "publish" } });
  expect(events).toEqual([{ name: "created", userId: "owner", properties: { source: "admin" } }]);
  expect(reports[0]!.context).toEqual({ operation: "create", attributes: { source: "admin" } });
  expect(starts).toEqual([{ name: "create", attributes: { source: "admin" } }]);
  expect(metrics).toEqual([{ input: { name: "queue.size", value: 3 }, options: { kind: "gauge", unit: "{item}", attributes: { queue: "publish" } } }]);
});

it("fans metrics out once to every provider and isolates synchronous and asynchronous provider faults", async () => {
  const seen: unknown[] = [], warnings: string[] = [];
  const recording = (id: string): ObservabilityPort => ({ ...createNoopObservabilityPort({}),
    metric(input, options) { seen.push({ id, input, options }); },
  });
  const observability = combineObservabilityPorts({ ports: [recording("first"),
    { ...createNoopObservabilityPort({}), metric() { throw new Error("private provider detail"); } },
    { ...createNoopObservabilityPort({}), metric: async () => { throw new Error("private async detail"); } },
    recording("last"),
  ] }, { onFailure: () => { warnings.push("provider failed"); } });
  const tracker = createTracker({ observability });
  const input = { name: "jobs", value: 2 }, options = { kind: "counter" as const, unit: "{job}" };
  expect(() => tracker.metric(input, options)).not.toThrow();
  await Promise.resolve();
  expect(seen).toEqual([{ id: "first", input, options }, { id: "last", input, options }]);
  expect(warnings).toEqual(["provider failed", "provider failed"]);
});

it("contains metric failures with one fixed warning even when the warning sink throws", async () => {
  const warnings: string[] = [];
  let reject = false;
  const tracker = createTracker({ observability: { ...createNoopObservabilityPort({}), metric() {
    if (reject) return Promise.reject(new Error("private exporter detail"));
    throw new Error("private metric detail");
  } } }, { warn(message) { warnings.push(message); throw new Error("logger failed"); } });
  tracker.metric({ name: "jobs", value: 1 });
  reject = true;
  tracker.metric({ name: "jobs", value: 2 });
  await Promise.resolve();
  expect(warnings).toEqual([WARNING]);
});

for (const asynchronous of [false, true]) {
  it(`preserves the callback's failure identity and runs it once (async=${asynchronous})`, async () => {
    const failure = { application: "failure" };
    const failingPort: ObservabilityPort = { ...createNoopObservabilityPort({}),
      trackOperation: () => ({ run<T>(fn: () => T): T { try { fn(); } catch { /* malicious SDK swallowing an application error */ } return fn(); }, end() { throw new Error("provider end failed"); } }),
      reportError() { throw new Error("provider report failed"); },
    };
    for (const tracker of [createNoopTracker({}), createTracker({}), createTracker({ observability: failingPort }, { warn() {} })]) {
      let calls = 0;
      const run = () => { calls++; if (asynchronous) return Promise.reject(failure); throw failure; };
      await expect(tracker.trace({ name: "deploy", run })).rejects.toBe(failure);
      expect(calls).toBe(1);
    }
  });
}

it("does not turn metrics into product events when only analytics is configured", () => {
  const events: ProductEvent[] = [];
  const tracker = createTracker({ productAnalytics: { capture(input) { events.push(input); }, identify() {} } });
  tracker.metric({ name: "jobs", value: 1 }, { kind: "counter" });
  expect(events).toEqual([]);
});
