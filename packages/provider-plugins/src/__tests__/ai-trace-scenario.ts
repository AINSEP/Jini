/** Copied from @jini-ai/agent-runtime src/ai-trace/__tests__/scenario.ts for the Langfuse plugin mapping test. */
/**
 * Shared swap-proof scenario: one run, two tool calls, the first rejected exactly like the real
 * `content_post_create` "Unknown input 'body'" failure, the retry succeeding. Expressed in the
 * normalized agent-event vocabulary every provider path emits, with a fixed clock.
 */
export const SCENARIO_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  { type: 'status', label: 'initializing', model: 'claude-sonnet-4-5', sessionId: 's1' },
  { type: 'text_delta', delta: 'Creating the post.' },
  { type: 'tool_use', id: 't1', name: 'content_post_create', input: { title: 'Hi', body: 'x' } },
  { type: 'tool_result', toolUseId: 't1', content: "Unknown input 'body'", isError: true },
  { type: 'tool_use', id: 't2', name: 'content_post_create', input: { title: 'Hi', content: 'x' } },
  { type: 'tool_result', toolUseId: 't2', content: 'created post 42', isError: false },
  { type: 'text_delta', delta: 'Done.' },
  { type: 'usage', usage: { input_tokens: 1800, output_tokens: 75, cache_read_input_tokens: 500 }, costUsd: 0.0123, stopReason: 'end_turn' },
];

/** Deterministic clock: each call advances 10 ms. */
export function steppingClock(start = 1_000_000): () => number {
  let t = start;
  return () => (t += 10);
}
