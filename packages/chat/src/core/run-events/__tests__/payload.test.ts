import { describe, expect, test } from "vitest";

import { parseUsageEvent as usage, translateRunAgentPayload as translate } from '../entry.js';
const parseUsageEvent = (payload: Parameters<typeof usage>[0]['payload']) => usage({ payload });
const translateRunAgentPayload = (payload: Parameters<typeof translate>[0]['payload']) => translate({ payload });

describe("translateRunAgentPayload — status", () => {
  test("carries label and detail through", () => {
    const translated = translateRunAgentPayload({ type: "status", label: "thinking", detail: "reading files" });
    expect(translated).toEqual({ kind: "status", label: "thinking", detail: "reading files" });
  });

  test("omits detail when the wire payload has none — undefined, not a stringified 'undefined'", () => {
    const translated = translateRunAgentPayload({ type: "status", label: "thinking" });
    expect(translated).toEqual({ kind: "status", label: "thinking" });
  });
});

describe("translateRunAgentPayload — text and thinking deltas", () => {
  test("text_delta becomes a 'text' AgentEvent carrying the delta verbatim", () => {
    expect(translateRunAgentPayload({ type: "text_delta", delta: "hello" })).toEqual({ kind: "text", text: "hello" });
  });

  test("thinking_delta becomes a 'thinking' AgentEvent, not conflated with text_delta", () => {
    expect(translateRunAgentPayload({ type: "thinking_delta", delta: "considering options" })).toEqual({
      kind: "thinking",
      text: "considering options",
    });
  });
});

describe("translateRunAgentPayload — tool lifecycle", () => {
  test("tool_use carries id, name, and the raw input value through untouched", () => {
    const input = { path: "/posts/1" };
    const translated = translateRunAgentPayload({ type: "tool_use", id: "t1", name: "open_post", input });
    expect(translated).toEqual({ kind: "tool_use", id: "t1", name: "open_post", input });
  });

  test("tool_result with isError:true reports failure, not silently swallowed", () => {
    const translated = translateRunAgentPayload({
      type: "tool_result",
      toolUseId: "t1",
      content: "404: post not found",
      isError: true,
    });
    expect(translated).toEqual({ kind: "tool_result", toolUseId: "t1", content: "404: post not found", isError: true });
  });

  test("tool_result with no isError field defaults to false, not undefined", () => {
    const translated = translateRunAgentPayload({ type: "tool_result", toolUseId: "t2", content: "ok" });
    expect(translated).toEqual({ kind: "tool_result", toolUseId: "t2", content: "ok", isError: false });
  });

  test("tool_result with a media array forwards it verbatim", () => {
    const media = [{ type: "image", mimeType: "image/png", data: "AAAA" }];
    const translated = translateRunAgentPayload({ type: "tool_result", toolUseId: "t3", content: "ok", media });
    expect(translated).toEqual({ kind: "tool_result", toolUseId: "t3", content: "ok", isError: false, media });
  });

  test("tool_result with no media field carries no media key at all — every pre-existing tool result is untouched", () => {
    const translated = translateRunAgentPayload({ type: "tool_result", toolUseId: "t4", content: "ok" });
    expect(translated).not.toHaveProperty("media");
  });

  test("tool_result with a malformed (non-array) media field drops it rather than forwarding garbage", () => {
    const translated = translateRunAgentPayload({ type: "tool_result", toolUseId: "t5", content: "ok", media: "not-an-array" });
    expect(translated).not.toHaveProperty("media");
  });
});

describe("translateRunAgentPayload — media survives a real SSE JSON round trip", () => {
  test("an image block emitted by the daemon is still present and structurally intact after JSON.stringify -> JSON.parse", () => {
    const media = [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" }];
    const sseDataLine = JSON.stringify({
      runId: "run-1",
      kind: "agent",
      payload: { type: "tool_result", toolUseId: "call-1", content: "Generated a swatch.", media },
    });

    const frame = JSON.parse(sseDataLine) as { payload: Parameters<typeof translateRunAgentPayload>[0] };
    const translated = translateRunAgentPayload(frame.payload);

    expect(translated).toEqual({
      kind: "tool_result",
      toolUseId: "call-1",
      content: "Generated a swatch.",
      isError: false,
      media,
    });
    expect((translated as { media?: Array<{ data: string }> }).media?.[0]?.data).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    );
  });

  test("multiple media blocks keep their exact order and every field after the same round trip", () => {
    const media = [
      { type: "image", mimeType: "image/png", data: "FIRST" },
      { type: "image", mimeType: "image/jpeg", data: "SECOND" },
    ];
    const sseDataLine = JSON.stringify({
      runId: "run-1",
      kind: "agent",
      payload: { type: "tool_result", toolUseId: "call-2", content: "ok", media },
    });

    const frame = JSON.parse(sseDataLine) as { payload: Parameters<typeof translateRunAgentPayload>[0] };
    const translated = translateRunAgentPayload(frame.payload) as { media?: unknown };

    expect(translated.media).toEqual(media);
  });
});

describe("translateRunAgentPayload — usage", () => {
  test("numeric fields all present are passed through as numbers", () => {
    const translated = translateRunAgentPayload({
      type: "usage",
      usage: { input_tokens: 120, output_tokens: 45 },
      costUsd: 0.012,
      durationMs: 890,
    });
    expect(translated).toEqual({ kind: "usage", inputTokens: 120, outputTokens: 45, costUsd: 0.012, durationMs: 890 });
  });

  test("a missing usage object does not throw — every field falls back to undefined", () => {
    const translated = translateRunAgentPayload({ type: "usage" });
    expect(translated).toEqual({ kind: "usage" });
  });

  test("non-numeric token/cost/duration fields are dropped rather than passed through as the wrong type", () => {
    const translated = translateRunAgentPayload({
      type: "usage",
      usage: { input_tokens: "120", output_tokens: null },
      costUsd: "0.01",
      durationMs: "890",
    });
    expect(translated).toEqual({ kind: "usage" });
  });
});

describe("parseUsageEvent", () => {
  test("numeric fields all present are passed through as numbers", () => {
    const event = parseUsageEvent({
      type: "usage",
      usage: { input_tokens: 120, output_tokens: 45 },
      costUsd: 0.012,
      durationMs: 890,
    });
    expect(event).toEqual({ kind: "usage", inputTokens: 120, outputTokens: 45, costUsd: 0.012, durationMs: 890 });
  });

  test("a missing usage object does not throw — every field falls back to undefined", () => {
    expect(parseUsageEvent({ type: "usage" })).toEqual({
      kind: "usage",
    });
  });

  test("non-numeric token/cost/duration fields are dropped rather than passed through as the wrong type", () => {
    const event = parseUsageEvent({
      type: "usage",
      usage: { input_tokens: "120", output_tokens: null },
      costUsd: "0.01",
      durationMs: "890",
    });
    expect(event).toEqual({ kind: "usage" });
  });
});

describe("translateRunAgentPayload — raw and surface events", () => {
  test("raw carries the line through asString", () => {
    expect(translateRunAgentPayload({ type: "raw", line: "npm run build" })).toEqual({ kind: "raw", line: "npm run build" });
  });

  test("a non-string raw line is JSON-stringified rather than dropped", () => {
    expect(translateRunAgentPayload({ type: "raw", line: { code: 1 } })).toEqual({ kind: "raw", line: '{"code":1}' });
  });

  test("mcp-ui unwraps .resource, not the whole envelope — required by parseUIResource's bare-EmbeddedResource shape", () => {
    const resource = { type: "resource", resource: { uri: "ui://confirm", mimeType: "text/html", text: "<div/>" } };
    const translated = translateRunAgentPayload({ type: "mcp-ui", resource });
    expect(translated).toEqual({ kind: "ext", name: "mcp-ui", data: resource });
  });

  test("thinking_start is dropped (returns null) — no dedicated chat-core AgentEvent variant for it", () => {
    expect(translateRunAgentPayload({ type: "thinking_start" })).toBeNull();
  });
});

describe("translateRunAgentPayload — slow_running falls through to the ext default branch", () => {
  test("becomes an ext event named 'slow_running', carrying the whole payload as data", () => {
    const translated = translateRunAgentPayload({
      type: "slow_running",
      detail: "Still working — this turn is taking longer than usual.",
    });
    expect(translated).toEqual({
      kind: "ext",
      name: "slow_running",
      data: { type: "slow_running", detail: "Still working — this turn is taking longer than usual." },
    });
  });
});
