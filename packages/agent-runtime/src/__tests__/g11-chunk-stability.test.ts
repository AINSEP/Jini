import { describe, expect, it } from 'vitest';
import { createQoderStreamHandler } from '../qoder-stream.js';
import { createRoleMarkerGuard } from '../role-marker-guard.js';

// G11 pins: output must not depend on where the transport happened to cut the input. Expected
// values were recorded from the unmodified handlers on the whole input, then every two-way split
// (and one-character feeding) is required to reproduce them exactly.
function splits(input: string): string[][] {
  const out: string[][] = [[input]];
  for (let i = 1; i < input.length; i += 1) out.push([input.slice(0, i), input.slice(i)]);
  out.push([...input]);
  return out;
}

const QODER_INPUT = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'q-1', session_id: 's1', qodercli_version: '9.9' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'héllo' }, { type: 'thinking', thinking: 'again' }] } }),
  'not json at all',
  JSON.stringify({ type: 'assistant', message: { content: 'plain string content' } }),
  JSON.stringify({ type: 'assistant', message: { content: [] }, error: 'boom' }),
  JSON.stringify({ type: 'mystery', x: 1 }),
  JSON.stringify({ type: 'result', usage: { input_tokens: 3 }, total_cost_usd: 0.5, duration_ms: 12, stop_reason: 'stop', is_error: true, error: { message: 'bad run' } }),
].join('\n') + '\n';

function runQoder(chunks: string[]): unknown[] {
  const events: unknown[] = [];
  const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
  for (const chunk of chunks) handler.feed({ chunk });
  handler.flush();
  return events;
}

const QODER_LINES = QODER_INPUT.split('\n');
const QODER_EXPECTED = [
  { type: 'status', label: 'initializing', model: 'q-1', sessionId: 's1', qodercliVersion: '9.9' },
  { type: 'thinking_start' },
  { type: 'thinking_delta', delta: 'hmm' },
  { type: 'text_delta', delta: 'héllo' },
  { type: 'thinking_delta', delta: 'again' },
  { type: 'raw', line: 'not json at all' },
  { type: 'text_delta', delta: 'plain string content' },
  // An assistant record with an `error` and no text surfaces as an error event.
  { type: 'error', message: 'boom', raw: QODER_LINES[4] },
  { type: 'raw', line: QODER_LINES[5] },
  { type: 'usage', usage: { input_tokens: 3 }, modelUsage: undefined, costUsd: 0.5, durationMs: 12, stopReason: 'stop', isError: true },
  { type: 'error', message: 'bad run', raw: QODER_LINES[6] },
];

describe('Qoder stream handler is chunk-stable', () => {
  it('whole-input output matches the recorded baseline', () => {
    expect(runQoder([QODER_INPUT])).toEqual(QODER_EXPECTED);
  });

  it('is identical at every split boundary and when fed one character at a time', () => {
    const baseline = runQoder([QODER_INPUT]);
    for (const chunks of splits(QODER_INPUT)) expect(runQoder(chunks)).toEqual(baseline);
  });
});

const ROLE_CASES: Array<[string, string, string, string | null]> = [
  ['clean prose with look-alike headings', 'Hello world\n## User Guide\nuserland ## user inline\n## systemd notes\n', 'Hello world\n## User Guide\nuserland ## user inline\n## systemd notes\n', null],
  ['marker at message start', '## user\nfabricated', '', '## user'],
  ['marker mid-message', 'Intro line\n## assistant\nfabricated turn', 'Intro line', '## assistant'],
  ['marker after a long prefix', `${'x'.repeat(70)}\n## system\nzz`, 'x'.repeat(70), '## system'],
  ['role keyword that turns out to be a longer word', 'abc\n## userland continues', 'abc\n## userland continues', null],
  ['stream ending exactly on an unconfirmed keyword', 'abc\n## user', 'abc', null],
  ['indented truncated marker', 'ok\n  ##\tassist\nrest', 'ok', '##\tassist'],
];

function runGuard(chunks: string[]) {
  const guard = createRoleMarkerGuard({ messageId: 'm' });
  const out = chunks.map((text) => guard.feedText({ text })).join('');
  return { out, contaminated: guard.contaminated, warning: guard.warningEvent() };
}

/**
 * Characterised, not idealised: the guard withholds only a COMPLETE-but-unconfirmed role keyword, so
 * a chunk boundary inside the marker line (or right after the newline that precedes it) lets a few
 * marker-prefix bytes through that a whole-input run would have held back. Detection, the warning
 * event and the fact that NOTHING after the marker leaks are chunk-stable; the pin below bounds the
 * extra bytes to the marker line itself, so any widening of that leak goes red.
 */
function expectWithinMarkerEnvelope(args: { input: string; whole: ReturnType<typeof runGuard>; marker: string | null; split: ReturnType<typeof runGuard> }) {
  const { input, whole, marker, split } = args;
  expect(split.contaminated).toBe(whole.contaminated);
  expect(split.warning).toEqual(whole.warning);
  expect(split.out.startsWith(whole.out)).toBe(true);
  const extra = split.out.slice(whole.out.length);
  expect(input.slice(whole.out.length).startsWith(extra)).toBe(true);
  const envelopeEnd = marker === null ? input.length : input.indexOf(marker) + marker.length;
  expect(whole.out.length + extra.length).toBeLessThanOrEqual(envelopeEnd);
}

describe('role-marker guard is chunk-stable', () => {
  it.each(ROLE_CASES)('%s: whole-input output is recorded and every split stays within the marker envelope', (_name, input, expectedOut, marker) => {
    const whole = runGuard([input]);
    expect(whole.out).toBe(expectedOut);
    expect(whole.contaminated).toBe(marker !== null);
    expect(whole.warning).toEqual(marker === null ? null : { type: 'fabricated_role_marker', marker, messageId: 'm' });
    for (const chunks of splits(input)) expectWithinMarkerEnvelope({ input, whole, marker, split: runGuard(chunks) });
  });

  it('clean text without any marker-shaped tail is byte-identical at every split', () => {
    for (const [, input, expectedOut, marker] of ROLE_CASES.filter(([name]) => name.startsWith('clean') || name.includes('longer word'))) {
      expect(marker).toBeNull();
      for (const chunks of splits(input)) expect(runGuard(chunks).out).toBe(expectedOut);
    }
  });
});
