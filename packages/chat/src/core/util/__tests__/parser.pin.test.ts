import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createArtifactParser, type ArtifactEvent } from '../parser.js';

// Sample covers: prose, a tag whose quoted attribute holds `>`, a body that
// mentions a fake close prefix, a fenced block that holds `<artifact`
// literally, a second artifact, and trailing prose.
const SAMPLE = [
  'intro ',
  '<artifact identifier="a1" type="text/html" title="x > y">body </art not-close</artifact>',
  ' mid\n```html\n<artifact identifier="fenced">\n```\n',
  '<artifact identifier="a2" type=\'t\'>two</artifact> tail <artifactual>',
].join('');
// Same plus an inline code span. Splitting between the span's `>` and its
// closing backtick is NOT split-invariant today (pass 1 sees a complete open
// before any hold-back), so this one is only pinned by recorded baseline.
const INLINE_SAMPLE = SAMPLE.replace(' mid\n', ' mid `<artifact identifier="no">` and\n');

function run(chunks: string[]): ArtifactEvent[] {
  const parser = createArtifactParser({});
  const events: ArtifactEvent[] = [];
  for (const delta of chunks) events.push(...parser.feed({ delta }));
  events.push(...parser.flush({}));
  return events;
}

/** Merge adjacent same-kind deltas so event granularity does not matter. */
function normalize(events: ArtifactEvent[]): unknown[] {
  const out: ArtifactEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.type === 'text' && last.type === 'text') out[out.length - 1] = { type: 'text', delta: last.delta + e.delta };
    else if (last && e.type === 'artifact:chunk' && last.type === 'artifact:chunk') out[out.length - 1] = { ...last, delta: last.delta + e.delta };
    else out.push(e);
  }
  return out;
}

describe('createArtifactParser pin (split-point parity)', () => {
  const whole = normalize(run([SAMPLE]));

  it('recognises both artifacts and keeps fenced/inline lookalikes as text', () => {
    const starts = whole.filter((e) => (e as ArtifactEvent).type === 'artifact:start');
    expect(starts).toHaveLength(2);
    expect(whole.find((e) => (e as ArtifactEvent).type === 'artifact:start')).toMatchObject({ title: 'x > y' });
    const ends = whole.filter((e) => (e as ArtifactEvent).type === 'artifact:end') as Array<{ fullContent: string }>;
    expect(ends.map((e) => e.fullContent)).toEqual(['body </art not-close', 'two']);
  });

  it('every two-chunk split normalises to the whole-input events', () => {
    for (let i = 0; i <= SAMPLE.length; i++) {
      expect(normalize(run([SAMPLE.slice(0, i), SAMPLE.slice(i)]))).toEqual(whole);
    }
  });

  it('char-by-char streaming normalises to the whole-input events', () => {
    expect(normalize(run([...SAMPLE]))).toEqual(whole);
  });

  it('raw event sequence across every split is byte-identical to the recorded baseline', () => {
    const all = [SAMPLE, INLINE_SAMPLE].flatMap((sample) => [
      ...Array.from({ length: sample.length + 1 }, (_, i) => run([sample.slice(0, i), sample.slice(i)])),
      run([...sample]),
    ]);
    const digest = createHash('sha256').update(JSON.stringify(all)).digest('hex');
    expect(digest).toBe('2dec4f5585dd908684268f577717c428bbc5b75709a4bf8100d6e2ac7ed7be0a');
  });

  it('an unterminated artifact flushes its buffered body and ends', () => {
    expect(run(['<artifact identifier="u" type="t" title="T">half </arti'])).toEqual([
      { type: 'artifact:start', identifier: 'u', artifactType: 't', title: 'T' },
      { type: 'artifact:chunk', identifier: 'u', delta: 'h' },
      { type: 'artifact:chunk', identifier: 'u', delta: 'alf </arti' },
      { type: 'artifact:end', identifier: 'u', fullContent: 'half </arti' },
    ]);
  });
});
