import { expect, it, vi } from 'vitest';
import { createAiTraceRecorder } from '@jini-ai/agent-runtime/ai-trace';
import { createAiGenerationSink, createNoopProductAnalytics, isNoopProductAnalytics, withProductAnalyticsGuards,
  type ProductAiGeneration, type ProductAnalyticsPort } from '../product/index.js';
import { injectBrowserAnalytics } from '../product/browser.js';

it('keeps full-content generations sparse when the stream has no prompt or answer', () => {
  const generations: ProductAiGeneration[] = [];
  const analytics: ProductAnalyticsPort = { includeAiContent: true, capture() {}, identify() {},
    captureAiGeneration: event => { generations.push(event); } };
  const sink = createAiGenerationSink({ analytics, userId: 'operator' })!;
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'agent' }, { now: () => 100 });
  recorder.observe({ type: 'thinking_delta', delta: 'reasoning stays private' });
  recorder.finish({ outcome: 'succeeded' });
  expect(generations).toEqual([{ userId: 'operator', properties: {
    traceId: 'r', spanId: 'r:turn:0', latencySeconds: 0, isError: false, toolCallCount: 0,
  } }]);
});

it('includes each available content side independently and converts nonzero TTFT to seconds', () => {
  const captureAiGeneration = vi.fn();
  const analytics = { includeAiContent: true, capture() {}, identify() {}, captureAiGeneration };
  const sink = createAiGenerationSink({ analytics, userId: 'operator' })!;
  const promptOnly = createAiTraceRecorder({ sink, runId: 'prompt', agentId: 'a' }, { now: () => 100 });
  promptOnly.start({ input: 'question' });
  promptOnly.observe({ type: 'status', ttftMs: 250 });
  promptOnly.finish({ outcome: 'succeeded' });
  const answerOnly = createAiTraceRecorder({ sink, runId: 'answer', agentId: 'a' }, { now: () => 100 });
  answerOnly.observe({ type: 'text_delta', delta: 'answer' });
  answerOnly.finish({ outcome: 'succeeded' });
  expect(captureAiGeneration.mock.calls).toEqual([
    [{ userId: 'operator', properties: { traceId: 'prompt', spanId: 'prompt:turn:0', latencySeconds: 0,
      isError: false, toolCallCount: 0, ttftSeconds: 0.25 }, input: 'question' }],
    [{ userId: 'operator', properties: { traceId: 'answer', spanId: 'answer:turn:0', latencySeconds: 0,
      isError: false, toolCallCount: 0, ttftSeconds: 0 }, output: 'answer' }],
  ]);
});

it('returns a shared inert analytics port whose guard never consults consent', () => {
  const noop = createNoopProductAnalytics({});
  const consent = vi.fn(() => true);
  expect(createNoopProductAnalytics({})).toBe(noop);
  expect(isNoopProductAnalytics(noop)).toBe(true);
  expect(Object.isFrozen(noop)).toBe(true);
  expect(withProductAnalyticsGuards({ inner: noop, consent })).toBe(noop);
  expect(noop.capture({ name: 'fixture', userId: 'u' })).toBeUndefined();
  expect(noop.identify({ userId: 'u' })).toBeUndefined();
  expect(consent).not.toHaveBeenCalled();
});

it('appends the browser contribution when HTML has no body closing tag and keeps injection idempotent', () => {
  const input = { html: '<main>İ</main>', contributions: [{ source: 'function(){return function(){};}',
    origins: [], supportsStatic: true }], surface: 'site' as const, delivery: 'static' as const };
  const output = injectBrowserAnalytics(input);
  expect(output.startsWith('<main>İ</main><script data-jini-browser-analytics>')).toBe(true);
  expect(output.endsWith('</script>')).toBe(true);
  expect(injectBrowserAnalytics({ ...input, html: output })).toBe(output);
});
