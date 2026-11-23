import { describe, expect, it } from 'vitest';
import {
  createTaggedTextSuppressor,
  emitWithTextSuppressor,
  possibleTagStart,
  TOOL_CALL_CLOSE_RE,
  TOOL_CALL_OPEN_RE,
  type ArtifactTextSuppressor,
} from '../tagged-text-suppression.js';

// A fixed artifact matcher supplies the same tag syntax as the original test cases.
function compactTagCandidate({ text, close }: { text: string; close: boolean }, _optional: Record<string, never> = {}): string | null {
  if (text.includes('>')) return null;
  return text.toLowerCase().replace(close ? /[<|/\s]/g : /[<|,\s]/g, '');
}

function isPossibleArtifactTag({ text, close }: { text: string; close: boolean }, _optional: Record<string, never> = {}): boolean {
  const compact = compactTagCandidate({ text, close });
  if (compact === null) return false;
  return compact.length === 0 || 'artifact'.startsWith(compact) || compact.startsWith('artifact');
}

function createArtifactSuppressor(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): ArtifactTextSuppressor {
  return createTaggedTextSuppressor({
    openRe: /(?:<\s*\|?\s*artifact\b[^>]*>)/i,
    closeRe: /(?:<\/artifact>|<\s*\|?\s*\/\s*artifact\s*\|?\s*>)/i,
    isPossibleOpen: ({ text }) => isPossibleArtifactTag({ text, close: false }),
    isPossibleClose: ({ text }) => isPossibleArtifactTag({ text, close: true }),
  });
}

describe('createTaggedTextSuppressor (copied artifact cases)', () => {
  it('preserves visible suffixes and counts multiple hidden blocks for every two-chunk split', () => {
    const first = '<artifact>secret one</artifact>';
    const second = '<artifact>secret two</artifact>';
    const text = `before ${first} between ${second} after`;
    for (let split = 0; split <= text.length; split += 1) {
      const s = createArtifactSuppressor({});
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
    const s = createArtifactSuppressor({});
    const out = s.strip({ text: 'before <artifact x="1">hidden</artifact> after' });
    expect(out).toBe('before  after');
    expect(s.stats().openedBlocks).toBe(1);
    expect(s.stats().closedBlocks).toBe(1);
  });

  it('suppresses a block split across multiple chunks, including a split tag boundary', () => {
    const s = createArtifactSuppressor({});
    let out = '';
    out += s.strip({ text: 'before <art' });
    out += s.strip({ text: 'ifact>hidd' });
    out += s.strip({ text: 'en</artifact> after' });
    expect(out).toBe('before  after');
  });

  it('handles a close tag split right at the boundary', () => {
    const s = createArtifactSuppressor({});
    let out = '';
    out += s.strip({ text: '<artifact>hidden</art' });
    out += s.strip({ text: 'ifact>visible' });
    expect(out).toBe('visible');
  });

  it('flush() returns pending non-suppressed candidate text, and nothing while suppressing', () => {
    const s = createArtifactSuppressor({});
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


  it('does not suppress unrelated text containing a bare "<" not matching any candidate', () => {
    const s = createArtifactSuppressor({});
    const out = s.strip({ text: 'a < b > c' });
    expect(out).toBe('a < b > c');
  });

  it('handles two sequential blocks', () => {
    const s = createArtifactSuppressor({});
    const out = s.strip({ text: '<artifact>a</artifact>mid<artifact>b</artifact>end' });
    expect(out).toBe('midend');
    expect(s.stats().openedBlocks).toBe(2);
    expect(s.stats().closedBlocks).toBe(2);
  });

  it('stats() tracks suppressed character/chunk counts', () => {
    const s = createArtifactSuppressor({});
    s.strip({ text: '<artifact>1234567890</artifact>' });
    const stats = s.stats();
    expect(stats.suppressedChars).toBeGreaterThan(0);
    expect(stats.suppressedChunks).toBeGreaterThan(0);
    expect(stats.suppressing).toBe(false);
    expect(stats.pendingCandidateChars).toBe(0);
  });


  it('returns text unchanged when its only "<" (at index 0) never resolves to a candidate', () => {
    const s = createArtifactSuppressor({});
    expect(s.strip({ text: '<x' })).toBe('<x');
  });

  it('does not hold back a close-tag candidate that can never match once suppressing', () => {
    const s = createArtifactSuppressor({});
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
    const s = createArtifactSuppressor({});
    expect(s.strip({ text: 'trailing <' })).toBe('trailing ');
    expect(s.hasPendingCandidate()).toBe(true);
    s.flush();

    s.strip({ text: '<artifact>hidden' });
    expect(s.strip({ text: 'more<' })).toBe('');
    expect(s.hasPendingCandidate()).toBe(true);
  });

  it('does not hold back a close-side candidate tail that already contains an unrelated ">"', () => {
    const s = createArtifactSuppressor({});
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
    const s = createArtifactSuppressor({});
    // A long run of "<" characters that never resolves to a real tag —
    // exercises possibleTagStart's lastIndexOf backtracking loop.
    const noise = '<'.repeat(600) + 'plain text';
    const out = s.strip({ text: noise });
    expect(out.endsWith('plain text')).toBe(true);
  });
});


describe('tagged suppressor state', () => {
  it('counts open, split close, and flush transitions', () => {
    const s = createArtifactSuppressor({});
    expect(s.strip({ text: 'start <art' })).toBe('start ');
    expect(s.stats()).toEqual({
      suppressedChars: 0, suppressedChunks: 0, openedBlocks: 0, closedBlocks: 0,
      pendingCandidateChars: 4, suppressing: false,
    });

    expect(s.strip({ text: 'ifact>xy</art' })).toBe('');
    expect(s.stats()).toEqual({
      suppressedChars: 12, suppressedChunks: 2, openedBlocks: 1, closedBlocks: 0,
      pendingCandidateChars: 5, suppressing: true,
    });

    expect(s.strip({ text: 'ifact>end <art' })).toBe('end ');
    expect(s.stats()).toEqual({
      suppressedChars: 23, suppressedChunks: 3, openedBlocks: 1, closedBlocks: 1,
      pendingCandidateChars: 4, suppressing: false,
    });
    expect(s.flush()).toBe('<art');
    expect(s.stats()).toEqual({
      suppressedChars: 23, suppressedChunks: 3, openedBlocks: 1, closedBlocks: 1,
      pendingCandidateChars: 0, suppressing: false,
    });
  });

  it('backtracks past non-matching candidates to a possible earlier suffix', () => {
    expect(possibleTagStart({ text: 'start <art <no', predicate: ({ text }) => text.startsWith('<art') })).toBe(6);
  });
});

describe('emitWithTextSuppressor', () => {
  it('emits a text_delta event only when non-empty text survives', () => {
    const s = createArtifactSuppressor({});
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

// B256: the one open/close definition both tool-call suppressors (agent-runtime ACP, artifacts) read.
describe('TOOL_CALL_OPEN_RE / TOOL_CALL_CLOSE_RE', () => {
  it.each(['<tool_call>', '<tool_call name="t">', '<TOOL_CALL/>', '<edit>', '<edit \t>'])('opens on %j', (tag) => {
    expect(TOOL_CALL_OPEN_RE.test(tag)).toBe(true);
  });
  it.each(['x < tool_call.count && y > 0', '< tool_call>', '<tool_calls>', '<tool_call a="1&2">', '<tool_call\n>'])('does not open on %j', (text) => {
    expect(TOOL_CALL_OPEN_RE.test(text)).toBe(false);
  });
  it.each(['</tool_call>', '</ tool_call >', '</edit>'])('closes on %j', (tag) => {
    expect(TOOL_CALL_CLOSE_RE.test(tag)).toBe(true);
  });
});
