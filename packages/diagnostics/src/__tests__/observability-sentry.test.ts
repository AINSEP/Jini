/** The Sentry provider subpath against the real SDK (recording transport, `.invalid` DSN: no network). */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createTransport, getCurrentScope } from "@sentry/node";

import { createSentryObservabilityAdapter, type SentryConfigEnabled } from "../observability/sentry.js";

const CONFIG: SentryConfigEnabled = { enabled: true, dsn: "https://public@sentry.invalid/1", tracesSampleRate: 1 };
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

type Item = { type: string; payload: Record<string, any> };
function recordingTransport() {
  const items: Item[] = [];
  const transport = (options: Parameters<typeof createTransport>[0]) => createTransport(options, async (request) => {
    const lines = String(request.body).split("\n").filter(Boolean);
    for (let i = 1; i + 1 < lines.length; i += 2) items.push({ type: JSON.parse(lines[i]!).type, payload: JSON.parse(lines[i + 1]!) });
    return { statusCode: 200 };
  });
  return { items, transport };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

test("review #4: independent operations start distinct traces; a nested one shares its parent's", async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const a = port.trackOperation({ name: "tool.call" });
  a.run(() => port.trackOperation({ name: "inner" }).end({ outcome: "completed", failed: false }));
  a.end({ outcome: "completed", failed: false });
  port.trackOperation({ name: "tool.call" }).end({ outcome: "completed", failed: false });
  await flush(); await dispose();
  const traces = items.filter((i) => i.type === "transaction").map((i) => i.payload.contexts.trace.trace_id);
  assert.equal(traces.length, 2);
  assert.notEqual(traces[0], traces[1]);
  const first = items.find((i) => i.type === "transaction")!.payload;
  assert.deepEqual(first.spans.map((s: { trace_id: string }) => s.trace_id), [traces[0]]);
});

test("review #5: the adapter neither sets the process async-context strategy nor turns on channel injection, yet still delivers", async () => {
  const carrier = (globalThis as { __SENTRY__?: Record<string, { acs?: unknown }> }).__SENTRY__;
  const before = JSON.stringify(Object.keys(carrier ?? {}).map((k) => [k, Boolean(carrier?.[k]?.acs)]));
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const after = JSON.stringify(Object.keys((globalThis as any).__SENTRY__ ?? {}).map((k) => [k, Boolean((globalThis as any).__SENTRY__[k]?.acs)]));
  assert.equal(after, before);
  const error = new Error(`token ${SECRET}`); error.name = SECRET;
  port.reportError({ error, context: { operation: "tool.call", attributes: { "tool.id": SECRET } } });
  await flush(); await dispose();
  assert.equal(items.filter((i) => i.type === "event").length, 1);
  assert.ok(!JSON.stringify(items).includes(SECRET));
  assert.equal(getCurrentScope().getClient(), undefined);
});

test("review #5: a host-owned client is reused and left open by dispose", async () => {
  const { transport } = recordingTransport();
  let closed = 0;
  const hostClient = { close: async () => { closed += 1; return true; }, getOptions: () => ({}) } as never;
  const { dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport, client: hostClient });
  await dispose();
  assert.equal(closed, 0);
});

test("review #6: dispose releases the SDK's beforeExit listeners (repeated open/close does not leak)", async () => {
  const baseline = process.listenerCount("beforeExit");
  for (let i = 0; i < 5; i += 1) {
    const { transport } = recordingTransport();
    const { dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
    assert.ok(process.listenerCount("beforeExit") > baseline);
    await dispose();
  }
  assert.equal(process.listenerCount("beforeExit"), baseline);
});
