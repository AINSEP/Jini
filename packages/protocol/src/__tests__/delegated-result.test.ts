import { describe, expect, it } from 'vitest';
import type { RunAgentPayload } from '../events.js';
import { delegatedResultMarker, readDelegatedResult } from '../delegated-result.js';

describe('delegated result marker v1', () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'PIXELS' };
  it('round trips metadata beside untouched original content', () => {
    const marker = delegatedResultMarker({ toolUseId: 'B' });
    expect(JSON.parse(marker.text)).toEqual({ jiniDelegatedResult: { version: 1, toolUseId: 'B' } });
    const content = [marker, image];
    expect(readDelegatedResult({ content })).toEqual({ marker: { version: 1, toolUseId: 'B' }, content: [image] });
    expect(content).toEqual([marker, image]);
  });
  it.each([undefined, 'plain', [image], [{ type: 'text', text: '{invalid' }], [{ type: 'text', text: '{"jiniDelegatedResult":{"version":2,"toolUseId":"B"}}' }], [{ type: 'text', text: '{"jiniDelegatedResult":{"version":1,"toolUseId":""}}' }], [{ type: 'text', text: '{"jiniDelegatedResult":{"version":1,"toolUseId":"B","extra":true}}' }], [delegatedResultMarker({ toolUseId: 'B' }), delegatedResultMarker({ toolUseId: 'C' }), image]].map(content => ({ content })))('falls back for absent, malformed, future or ambiguous metadata: %j', ({ content }) => {
    expect(readDelegatedResult({ content })).toBeUndefined();
  });
  it('keeps old and new wire payloads readable without migration', () => {
    const old: RunAgentPayload = { type: 'tool_result', toolUseId: 'C', content: 'old pixels' };
    const current: RunAgentPayload = { ...old, content: 'Result shown by delegated call B.', delegatedToolUseId: 'B' };
    expect(JSON.parse(JSON.stringify(old))).toEqual(old);
    expect(JSON.parse(JSON.stringify(current))).toEqual(current);
  });
});
