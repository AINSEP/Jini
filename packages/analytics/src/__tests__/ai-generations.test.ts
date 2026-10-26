import { expect, test } from "vitest";
import { createAiTraceRecorder, createFanOutAiTraceSink, createRecordingAiTraceSink } from "@jini-ai/agent-runtime/ai-trace";
import { createAiGenerationSink, createNoopProductAnalytics, withProductAnalyticsGuards, type ProductAiGeneration, type ProductAnalyticsPort } from "../product/index.js";

function recordingAnalytics({ includeAiContent = false }: { includeAiContent?: boolean } = {}) {
  const events: ProductAiGeneration[] = [];
  const port: ProductAnalyticsPort = { capture() {}, identify() {}, includeAiContent, captureAiGeneration: (event) => { events.push(event); } };
  return { events, port };
}

test("the real recorder sends model metadata, known cost and distinct tool count; no prompt, response or contextRef", () => {
  const { events, port } = recordingAnalytics();
  const sink = createAiGenerationSink({ analytics: withProductAnalyticsGuards({ inner: port, consent: () => true }), userId: "site:s1" })!;
  let time = 1_000;
  const recorder = createAiTraceRecorder({ sink, runId: "r1", agentId: "fixture" }, { provider: "anthropic", model: "model-1", sessionId: "private-context-envelope", now: () => time });
  recorder.start({ input: "private prompt" });
  recorder.observe({ type: "text_delta", delta: "private response" });
  recorder.observe({ type: "tool_use", id: "t1", name: "read", input: { secret: "private tool input" } });
  recorder.observe({ type: "tool_use", id: "t1", name: "read", input: {} });
  time = 2_500;
  recorder.observe({ type: "usage", usage: { input_tokens: 12, output_tokens: 4 }, costUsd: 0.01 });
  recorder.finish({ outcome: "succeeded" });
  expect(events).toEqual([{ userId: "site:s1", properties: { model: "model-1", provider: "anthropic", traceId: "r1", spanId: "r1:turn:0", latencySeconds: 1.5, isError: false, toolCallCount: 1, inputTokens: 12, outputTokens: 4, costUsd: 0.01, costSource: "provider", ttftSeconds: 0 } }]);
  expect(JSON.stringify(events)).not.toContain("private");
});

test("consent false and stale async approvals drop generations; unknown usage and cost stay absent", async () => {
  const { events, port } = recordingAnalytics();
  let revision = 0;
  let answer!: (allowed: boolean) => void;
  const analytics = withProductAnalyticsGuards({ inner: port, consent: () => new Promise<boolean>((resolve) => { answer = resolve; }) }, { consentRevision: () => revision });
  const recorder = createAiTraceRecorder({ sink: createAiGenerationSink({ analytics, userId: "site:s1" })!, runId: "r", agentId: "a" });
  recorder.observe({ type: "error", message: "private provider error" });
  recorder.finish({ outcome: "failed" });
  revision++;
  answer(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  const denied = withProductAnalyticsGuards({ inner: port, consent: () => false });
  denied.captureAiGeneration!({ userId: "site:s1", properties: { isError: true } });
  expect(events).toEqual([]);
  const allowed = createAiTraceRecorder({ sink: createAiGenerationSink({ analytics: port, userId: "site:s1" })!, runId: "next", agentId: "a" });
  allowed.observe({ type: "error", message: "private provider error" });
  allowed.finish({ outcome: "failed" });
  expect(events[0]?.properties.isError).toBe(true);
  for (const key of ["inputTokens", "outputTokens", "costUsd", "model", "provider"]) expect(events[0]?.properties).not.toHaveProperty(key);
  expect(JSON.stringify(events)).not.toContain("private provider error");
});

test("no AI capability means no sink; bounded live runs are isolated, released at finish and inert after shutdown", async () => {
  expect(createAiGenerationSink({ analytics: createNoopProductAnalytics({}), userId: "s" })).toBeUndefined();
  const { events, port } = recordingAnalytics();
  const sink = createAiGenerationSink({ analytics: port, userId: "s" }, { maxActiveRuns: 1 })!;
  const run = (runId: string, provider: string) => createAiTraceRecorder({ sink, runId, agentId: "a" }, { provider });
  const first = run("r1", "first"), excess = run("r2", "excess");
  first.start({}); excess.start({});
  excess.observe({ type: "text_delta", delta: "dropped" }); excess.finish({ outcome: "succeeded" });
  first.observe({ type: "text_delta", delta: "one" }); first.finish({ outcome: "succeeded" });
  const next = run("r3", "next");
  next.observe({ type: "text_delta", delta: "two" }); next.finish({ outcome: "succeeded" });
  expect(events.map(({ properties }) => properties.provider)).toEqual(["first", "next"]);
  await sink.shutdown!();
  const late = run("late", "late"); late.observe({ type: "text_delta", delta: "ignored" }); late.finish({ outcome: "succeeded" });
  expect(events).toHaveLength(2);
});

test("full capture is explicit, bounded and redacted, while another trace destination still receives metadata only", () => {
  const { events, port } = recordingAnalytics({ includeAiContent: true });
  const analytics = withProductAnalyticsGuards({ inner: port, consent: () => true });
  const metadata = createRecordingAiTraceSink();
  const sink = createFanOutAiTraceSink({ sinks: [createAiGenerationSink({ analytics, userId: "s" })!, metadata] });
  const secret = ["private", "credential", "value"].join("-");
  const recorder = createAiTraceRecorder({ sink, runId: "r", agentId: "a" }, { exactSecrets: [secret] });
  recorder.start({ input: `prompt ${secret}` });
  recorder.observe({ type: "text_delta", delta: "response" });
  recorder.observe({ type: "thinking_delta", delta: "private reasoning" });
  recorder.observe({ type: "tool_use", id: "t", name: "read", input: "private tool input" });
  recorder.observe({ type: "tool_result", toolUseId: "t", content: "private tool output" });
  recorder.observe({ type: "error", message: "private error prose" });
  recorder.finish({ outcome: "failed" });
  expect(events[0]?.input).toContain("prompt ");
  expect(events[0]?.input).not.toContain(secret);
  expect(events[0]?.output).toBe("response");
  expect(JSON.stringify(metadata.events)).not.toMatch(/prompt |response|private /);
  analytics.captureAiGeneration!({ userId: "s", properties: { traceId: "bounded" }, input: "x".repeat(20_000) });
  expect(events[1]?.input).toHaveLength(16_000);
});

test("the guard strips unsolicited content, refuses PII metadata and contains a failing AI provider", () => {
  const { events, port } = recordingAnalytics();
  const guarded = withProductAnalyticsGuards({ inner: port, consent: () => true });
  guarded.captureAiGeneration!({ userId: "s", properties: { traceId: "r" }, input: "private", output: "private" });
  expect(events).toEqual([{ userId: "s", properties: { traceId: "r" } }]);
  guarded.captureAiGeneration!({ userId: "s", properties: { model: "a@example.test" } });
  expect(events).toHaveLength(1);
  const broken = withProductAnalyticsGuards({ inner: { ...port, captureAiGeneration() { throw new Error("down"); } }, consent: () => true });
  expect(() => broken.captureAiGeneration!({ userId: "s", properties: {} })).not.toThrow();
});
