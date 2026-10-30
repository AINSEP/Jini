import { expect, it } from 'vitest';
import { runAnthropicToolTurn, type AnthropicTurnEvent } from '../anthropic-messages.js';

it('retains initial input usage when the final delta reports only output usage', async () => {
  const events: AnthropicTurnEvent[] = [];
  const frames = [
    { type: 'message_start', message: { usage: { input_tokens: 7 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ];
  const result = await runAnthropicToolTurn({ apiKey: 'test-key', model: 'chosen-model', maxTokens: 30,
    messages: [{ role: 'user', content: 'Hello' }], onEvent: event => events.push(event) }, {
    dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '', body: {
      async *[Symbol.asyncIterator]() { for (const frame of frames) yield new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`); },
    } }),
  });
  expect(result).toEqual({ stopReason: 'end_turn', toolTurns: 0 });
  expect(events.filter(event => event.type === 'usage')).toEqual([{ type: 'usage', usage: { input_tokens: 7, output_tokens: 3 } }]);
  expect(events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
});
