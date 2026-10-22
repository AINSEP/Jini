import { describe, expect, it } from 'vitest';
import {
  createTaggedTextSuppressor,
  createToolCallTextSuppressor,
  createXmlTagTextSuppressor,
  emitWithTextSuppressor,
  type ArtifactTextSuppressor,
} from '../text-suppression.js';

describe('createXmlTagTextSuppressor', () => {
  it('preserves visible suffixes and counts multiple hidden blocks for every two-chunk split', () => {
    const first = '<artifact>secret one</artifact>';
    const second = '<artifact>secret two</artifact>';
    const text = `before ${first} between ${second} after`;
    for (let split = 0; split <= text.length; split += 1) {
      const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
      const out = s.strip({ text: text.slice(0, split) }) + s.strip({ text: text.slice(split) }) + s.flush();
      expect(out).toBe('before  between  after');
      expect(s.stats().openedBlocks).toBe(2);
      expect(s.stats().closedBlocks).toBe(2);
      expect(s.stats().suppressedChars).toBe(first.length + second.length);
      expect(s.isSuppressing()).toBe(false);
      expect(s.hasPendingCandidate()).toBe(false);
    }
  });

  it('suppresses a complete tagged block delivered in one chunk', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    const out = s.strip({ text: 'before <artifact x="1">hidden</artifact> after' });
    expect(out).toBe('before  after');
    expect(s.stats().openedBlocks).toBe(1);
    expect(s.stats().closedBlocks).toBe(1);
  });

  it('suppresses a block split across multiple chunks, including a split tag boundary', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    let out = '';
    out += s.strip({ text: 'before <art' });
    out += s.strip({ text: 'ifact>hidd' });
    out += s.strip({ text: 'en</artifact> after' });
    expect(out).toBe('before  after');
  });

  it('handles a close tag split right at the boundary', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    let out = '';
    out += s.strip({ text: '<artifact>hidden</art' });
    out += s.strip({ text: 'ifact>visible' });
    expect(out).toBe('visible');
  });

  it('flush() returns pending non-suppressed candidate text, and nothing while suppressing', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    const immediate = s.strip({ text: 'trailing <arti' });
    expect(immediate).toBe('trailing ');
    expect(s.isSuppressing()).toBe(false);
    expect(s.hasPendingCandidate()).toBe(true);
    expect(s.flush()).toBe('<arti');
    expect(s.hasPendingCandidate()).toBe(false);

    s.strip({ text: '<artifact>never closes' });
    expect(s.isSuppressing()).toBe(true);
    expect(s.flush()).toBe('');
  });

  it('matches the bracket-pipe open/close variant', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    const out = s.strip({ text: 'a <|artifact>hidden<|/artifact|> b' });
    expect(out).toBe('a  b');
  });

  it('supports multiple tag names in one suppressor', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact', 'thinking'] });
    expect(s.strip({ text: '<thinking>secret</thinking>visible' })).toBe('visible');
  });

  it('does not suppress unrelated text containing a bare "<" not matching any candidate', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    const out = s.strip({ text: 'a < b > c' });
    expect(out).toBe('a < b > c');
  });

  it('handles two sequential blocks', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    const out = s.strip({ text: '<artifact>a</artifact>mid<artifact>b</artifact>end' });
    expect(out).toBe('midend');
    expect(s.stats().openedBlocks).toBe(2);
    expect(s.stats().closedBlocks).toBe(2);
  });

  it('stats() tracks suppressed character/chunk counts', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    s.strip({ text: '<artifact>1234567890</artifact>' });
    const stats = s.stats();
    expect(stats.suppressedChars).toBeGreaterThan(0);
    expect(stats.suppressedChunks).toBeGreaterThan(0);
    expect(stats.suppressing).toBe(false);
    expect(stats.pendingCandidateChars).toBe(0);
  });

  it('escapes regex metacharacters in tag names', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['a+b'] });
    const out = s.strip({ text: 'x <a+b>hidden</a+b> y' });
    expect(out).toBe('x  y');
  });

  it('returns text unchanged when its only "<" (at index 0) never resolves to a candidate', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    expect(s.strip({ text: '<x' })).toBe('<x');
  });

  it('does not hold back a close-tag candidate that can never match once suppressing', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    s.strip({ text: '<artifact>hidden' });
    expect(s.isSuppressing()).toBe(true);
    // "<zzz" cannot be a prefix of "</artifact>"/"<|/artifact|>" in either
    // direction — isPossibleClose returns false, so it's suppressed outright
    // rather than held back as a pending candidate.
    s.strip({ text: '<zzz' });
    expect(s.hasPendingCandidate()).toBe(false);
    expect(s.isSuppressing()).toBe(true);
  });

  it('treats a bare "<" (empty compact candidate) as a possible open, on both open and close sides', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    expect(s.strip({ text: 'trailing <' })).toBe('trailing ');
    expect(s.hasPendingCandidate()).toBe(true);
    s.flush();

    s.strip({ text: '<artifact>hidden' });
    expect(s.strip({ text: 'more<' })).toBe('');
    expect(s.hasPendingCandidate()).toBe(true);
  });

  it('does not hold back a close-side candidate tail that already contains an unrelated ">"', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    s.strip({ text: '<artifact>hidden' });
    expect(s.isSuppressing()).toBe(true);
    // The tail from the last "<" is "<b>c", which already contains ">" —
    // compactTagCandidate returns null for it, so it's suppressed outright
    // rather than held back as a pending close candidate.
    s.strip({ text: 'draw a<b>c' });
    expect(s.hasPendingCandidate()).toBe(false);
    expect(s.isSuppressing()).toBe(true);
  });

  it('resets the candidate buffer once a definite non-match is found past the lookback window', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    // A long run of "<" characters that never resolves to a real tag —
    // exercises possibleTagStart's lastIndexOf backtracking loop.
    const noise = '<'.repeat(600) + 'plain text';
    const out = s.strip({ text: noise });
    expect(out.endsWith('plain text')).toBe(true);
  });
});

describe('createToolCallTextSuppressor', () => {
  it('suppresses a <tool_call>...</tool_call> block', () => {
    const s = createToolCallTextSuppressor({});
    expect(s.strip({ text: 'before <tool_call>{"x":1}</tool_call> after' })).toBe('before  after');
  });

  it('suppresses an <edit>...</edit> block', () => {
    const s = createToolCallTextSuppressor({});
    expect(s.strip({ text: 'before <edit>patch</edit> after' })).toBe('before  after');
  });

  it('handles a split close tag for tool_call', () => {
    const s = createToolCallTextSuppressor({});
    let out = '';
    out += s.strip({ text: '<tool_call>x</tool' });
    out += s.strip({ text: '_call>after' });
    expect(out).toBe('after');
  });

  it('holds back a possible-open candidate for tool_call/edit', () => {
    const s = createToolCallTextSuppressor({});
    const immediate = s.strip({ text: 'trailing <too' });
    expect(immediate).toBe('trailing ');
    expect(s.hasPendingCandidate()).toBe(true);
    expect(s.flush()).toBe('<too');
  });

  it('does not treat unrelated "<" text as a candidate', () => {
    const s = createToolCallTextSuppressor({});
    expect(s.strip({ text: 'a < b' })).toBe('a < b');
  });

  it('does not hold back a close-tag candidate that can never match tool_call/edit once suppressing', () => {
    const s = createToolCallTextSuppressor({});
    s.strip({ text: '<tool_call>hidden' });
    expect(s.isSuppressing()).toBe(true);
    s.strip({ text: '<zzz' });
    expect(s.hasPendingCandidate()).toBe(false);
    expect(s.isSuppressing()).toBe(true);
  });

  it('treats a bare "<" as a possible open candidate', () => {
    const s = createToolCallTextSuppressor({});
    expect(s.strip({ text: 'trailing <' })).toBe('trailing ');
    expect(s.hasPendingCandidate()).toBe(true);
  });

  it('does not hold back an open-side candidate tail that already contains an unrelated ">"', () => {
    const s = createToolCallTextSuppressor({});
    expect(s.strip({ text: 'draw a<b>c' })).toBe('draw a<b>c');
  });

  it('does not hold back a close-side candidate tail that already contains an unrelated ">"', () => {
    const s = createToolCallTextSuppressor({});
    s.strip({ text: '<tool_call>hidden' });
    expect(s.isSuppressing()).toBe(true);
    s.strip({ text: 'draw a<b>c' });
    expect(s.hasPendingCandidate()).toBe(false);
    expect(s.isSuppressing()).toBe(true);
  });
});

describe('emitWithTextSuppressor', () => {
  it('emits a text_delta event only when non-empty text survives', () => {
    const s = createXmlTagTextSuppressor({ tagNames: ['artifact'] });
    const events: unknown[] = [];
    const emitted1 = emitWithTextSuppressor({ suppressor: s, onEvent: (e) => events.push(e), text: 'hello' });
    expect(emitted1).toBe(true);
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);

    const emitted2 = emitWithTextSuppressor({ suppressor: s, onEvent: (e) => events.push(e), text: '<artifact>' });
    expect(emitted2).toBe(false);
    expect(events).toHaveLength(1);
  });
});

describe('createTaggedTextSuppressor (raw factory)', () => {
  it('is the primitive createXmlTagTextSuppressor/createToolCallTextSuppressor are built on', () => {
    const s: ArtifactTextSuppressor = createTaggedTextSuppressor({
      openRe: /\[hide\]/,
      closeRe: /\[\/hide\]/,
      isPossibleOpen: ({ text: t }) => '[hide]'.startsWith(t) || t.startsWith('[hide]'),
      isPossibleClose: ({ text: t }) => '[/hide]'.startsWith(t) || t.startsWith('[/hide]'),
    });
    expect(s.strip({ text: 'a [hide]b[/hide] c' })).toBe('a  c');
  });
});
