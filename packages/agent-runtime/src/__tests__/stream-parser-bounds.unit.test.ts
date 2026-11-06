import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler } from '../claude-stream.js';
import { createJsonEventStreamHandler } from '../json-event-stream.js';
import { createQoderStreamHandler } from '../qoder-stream.js';

const LIMIT = 8 * 1024 * 1024;
type Event = Record<string, unknown>;
const parsers = [
  ['Claude', (onEvent: (event: Event) => void) => createClaudeStreamHandler({ onEvent })],
  ['JSON event', (onEvent: (event: Event) => void) => createJsonEventStreamHandler({ kind: 'unknown', onEvent })],
  ['Qoder', (onEvent: (event: Event) => void) => createQoderStreamHandler({ onEvent })],
] as const;

for (const [name, create] of parsers) {
  describe(`${name} physical line bounds`, () => {
    it('accepts exactly the physical line limit', () => {
      const events: Event[] = [];
      const parser = create(event => events.push(event));
      parser.feed({ chunk: `${'x'.repeat(LIMIT)}\n` });
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('raw');
      expect((events[0]?.line as string).length).toBe(LIMIT);
    });
    it('reports one oversized single-chunk line and recovers at the next newline', () => {
      const events: Event[] = [];
      const parser = create(event => events.push(event));
      parser.feed({ chunk: `${'x'.repeat(LIMIT + 1)}\nrecovered\n` });
      expect(events).toEqual([
        expect.objectContaining({ type: 'error', message: `Agent output line exceeded ${LIMIT} characters.` }),
        { type: 'raw', line: 'recovered' },
      ]);
    });
    it('counts split chunks together and never interprets an oversized-line suffix', () => {
      const events: Event[] = [];
      const parser = create(event => events.push(event));
      parser.feed({ chunk: 'x'.repeat(LIMIT) });
      expect(events).toEqual([]);
      parser.feed({ chunk: 'y' });
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('error');
      parser.feed({ chunk: 'discarded suffix\nrecovered\n' });
      parser.flush();
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'raw', line: 'recovered' });
    });
    it('does not duplicate an oversized unterminated-tail error on flush', () => {
      const events: Event[] = [];
      const parser = create(event => events.push(event));
      parser.feed({ chunk: 'x'.repeat(LIMIT + 1) });
      parser.flush(); parser.flush();
      expect(events).toEqual([expect.objectContaining({ type: 'error', message: `Agent output line exceeded ${LIMIT} characters.` })]);
    });
  });
}
