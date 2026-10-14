import { describe, expect, it } from 'vitest';
import { runGoogleToolTurn, type GoogleTurnEvent } from '../google-messages.js';
import type { PinnedFetch } from '../connection-guard.js';

/** Fake only the injected transport; exercise real framing, parsing and turn completion. */
function responseFor({ frames }: { frames: readonly unknown[] }): PinnedFetch {
  return async () => ({
    ok: true, status: 200, text: async () => '',
    body: { async *[Symbol.asyncIterator]() {
      for (const frame of frames) yield new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
    } },
  });
}

const required = {
  apiKey: 'google-empty-turn-test-key', model: 'gemini-test',
  contents: [{ role: 'user' as const, parts: [{ text: 'Hello' }] }],
};

describe('Google empty initial turn', () => {
  for (const { name, frames, reason } of [
    { name: 'thinking exhausts the output cap', frames: [{ candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 1024 } }], reason: 'MAX_TOKENS' },
    { name: 'usage-only stream', frames: [{ usageMetadata: { totalTokenCount: 7 } }], reason: 'missing finish reason' },
    { name: 'empty successful candidate', frames: [{ candidates: [{ finishReason: 'STOP' }] }], reason: 'STOP' },
    { name: 'whitespace-only candidate', frames: [{ candidates: [{ content: { parts: [{ text: ' \n' }] }, finishReason: 'STOP' }] }], reason: 'STOP' },
  ]) {
    it(`reports an error instead of success for ${name}`, async () => {
      const events: GoogleTurnEvent[] = [];
      const result = await runGoogleToolTurn({ ...required, onEvent: event => events.push(event) }, {
        baseUrl: 'http://127.0.0.1:1234', fetchImpl: responseFor({ frames }),
      });
      expect(events.filter(event => event.type === 'error')).toEqual([
        { type: 'error', message: `Google returned no text or tool calls (${reason})` },
      ]);
      expect(events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
      expect(result.toolTurns).toBe(0);
    });
  }

  it('keeps a partial answer cut off by MAX_TOKENS successful', async () => {
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ ...required, onEvent: event => events.push(event) }, {
      baseUrl: 'http://127.0.0.1:1234', fetchImpl: responseFor({ frames: [
        { candidates: [{ content: { parts: [{ text: 'Hello!' }] }, finishReason: 'MAX_TOKENS' }] },
        { usageMetadata: { totalTokenCount: 7 } },
      ] }),
    });
    expect(events.filter(event => event.type === 'error')).toEqual([]);
    expect(events.filter(event => event.type === 'text_delta')).toEqual([{ type: 'text_delta', delta: 'Hello!' }]);
    expect(events.at(-1)).toEqual({ type: 'end', reason: 'stop' });
  });

  it('preserves tool-only turns whose host action is already the answer', async () => {
    const events: GoogleTurnEvent[] = [];
    const calls: string[] = [];
    let requests = 0;
    const fetchImpl: PinnedFetch = async input => responseFor({ frames: ++requests === 1 ? [
      { candidates: [{ content: { parts: [{ functionCall: { name: 'navigate', args: {}, id: 'action' } }] }, finishReason: 'STOP' }] },
    ] : [{ candidates: [{ finishReason: 'STOP' }] }] })(input);
    await runGoogleToolTurn({ ...required, onEvent: event => events.push(event) }, {
      baseUrl: 'http://127.0.0.1:1234', fetchImpl,
      executeTool: async call => { calls.push(call.name); return { content: 'navigated' }; },
    });
    expect(calls).toEqual(['navigate']);
    expect(requests).toBe(2);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'end', reason: 'stop' });
  });
});
