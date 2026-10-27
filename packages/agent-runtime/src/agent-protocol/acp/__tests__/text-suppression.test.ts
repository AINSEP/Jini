import { describe, expect, it, vi } from 'vitest';
import {
  createDsmlArtifactTextSuppressor,
  createToolCallTextSuppressor,
  emitWithTextSuppressor,
} from '../text-suppression.js';

describe('createDsmlArtifactTextSuppressor', () => {
  it('passes through text with no artifact tag untouched', () => {
    const s = createDsmlArtifactTextSuppressor();
    expect(s.strip('hello world')).toBe('hello world');
    expect(s.isSuppressing()).toBe(false);
    expect(s.hasPendingCandidate()).toBe(false);
  });

  it('suppresses a complete <artifact>...</artifact> block within one chunk', () => {
    const s = createDsmlArtifactTextSuppressor();
    expect(s.strip('before <artifact>hidden</artifact> after')).toBe('before  after');
    const stats = s.stats();
    expect(stats.openedBlocks).toBe(1);
    expect(stats.closedBlocks).toBe(1);
    expect(stats.suppressedChars).toBeGreaterThan(0);
  });

  it('suppresses a DSML artifact block using the pipe-delimited close tag', () => {
    const s = createDsmlArtifactTextSuppressor();
    const out = s.strip('<|DSML, artifact|>hidden content<|/DSML|>after');
    expect(out).toBe('after');
  });

  it('handles an artifact block split across multiple strip() calls', () => {
    const s = createDsmlArtifactTextSuppressor();
    expect(s.strip('before <artif')).toBe('before ');
    expect(s.hasPendingCandidate()).toBe(true);
    expect(s.strip('act>hidden</artifact> after')).toBe(' after');
    expect(s.isSuppressing()).toBe(false);
  });

  it('handles the closing tag split across multiple strip() calls', () => {
    const s = createDsmlArtifactTextSuppressor();
    expect(s.strip('<artifact>hidden</art')).toBe('');
    expect(s.isSuppressing()).toBe(true);
    expect(s.strip('ifact>after')).toBe('after');
  });

  it('flush() drains a pending non-suppressing candidate', () => {
    const s = createDsmlArtifactTextSuppressor();
    s.strip('some text <arti');
    expect(s.hasPendingCandidate()).toBe(true);
    expect(s.flush()).toBe('<arti');
  });

  it('flush() returns empty while still suppressing (nothing safe to emit)', () => {
    const s = createDsmlArtifactTextSuppressor();
    s.strip('<artifact>never closes');
    expect(s.isSuppressing()).toBe(true);
    expect(s.flush()).toBe('');
  });

  it('gives up scanning once it reaches a non-matching "<" at the very start of the text', () => {
    const s = createDsmlArtifactTextSuppressor();
    // The only "<" in the text is at index 0 and does not look like any
    // artifact/DSML canonical prefix, so possibleTagStart's backward scan
    // hits its `index === 0` termination case directly.
    expect(s.strip('<zzzzzzzzzz not a real tag at all')).toBe('<zzzzzzzzzz not a real tag at all');
  });

  it('treats a longer-than-canonical close-tag prefix (e.g. "<artifactzzz") as a possible close candidate', () => {
    const s = createDsmlArtifactTextSuppressor();
    s.strip('<artifact>');
    expect(s.isSuppressing()).toBe(true);
    // "artifactzzz" is longer than the "artifact" close canonical and
    // starts with it, but the canonical does not start with it —
    // exercises the `compact.startsWith(canonical)` side specifically.
    expect(s.strip('hidden <artifactzzz')).toBe('');
    expect(s.hasPendingCandidate()).toBe(true);
  });

  it('does not arm suppression for a "<" that is already resolved by a later ">" elsewhere in the same chunk', () => {
    const s = createDsmlArtifactTextSuppressor();
    // "< 5 >" has both a '<' and, later in the same string, a '>' — every
    // candidate-start position considered for it has a tail that already
    // contains '>', so it can never be a *growing* open-tag prefix.
    expect(s.strip('price < 5 > done')).toBe('price < 5 > done');
    expect(s.hasPendingCandidate()).toBe(false);
  });

  it('does not treat a "<...>"-containing chunk as a possible close-tag prefix while suppressing', () => {
    const s = createDsmlArtifactTextSuppressor();
    s.strip('<artifact>');
    expect(s.isSuppressing()).toBe(true);
    // Same shape as the open-tag case above, but exercised while inside a
    // suppressed block, against the close-tag candidate predicate.
    expect(s.strip('mid < 5 > text')).toBe('');
    expect(s.hasPendingCandidate()).toBe(false);
    expect(s.isSuppressing()).toBe(true);
  });

  it('a false-positive tag-start candidate resolves back to plain text once ruled out', () => {
    const s = createDsmlArtifactTextSuppressor();
    // "<a" could still grow into "<artifact...", but "<a href" rules it out
    // immediately since a real anchor tag never matches the artifact/DSML
    // canonical prefixes.
    const out = s.strip('text <a href="x">link</a>');
    expect(out).toContain('link');
  });

  it('treats a longer-than-canonical prefix (e.g. "<artifactx") as a possible open candidate', () => {
    const s = createDsmlArtifactTextSuppressor();
    // "artifactx" is longer than the "artifact" canonical and starts with
    // it, but the canonical does not start with it — exercises the
    // `compact.startsWith(ARTIFACT_OPEN_CANONICAL)` branch specifically.
    expect(s.strip('before <artifactx')).toBe('before ');
    expect(s.hasPendingCandidate()).toBe(true);
  });

  it('tracks multiple suppressed chunks across repeated strip() calls while suppressing', () => {
    const s = createDsmlArtifactTextSuppressor();
    s.strip('<artifact>');
    s.strip('chunk1');
    s.strip('chunk2');
    const stats = s.stats();
    expect(stats.suppressedChunks).toBeGreaterThanOrEqual(2);
    expect(s.isSuppressing()).toBe(true);
  });
});

describe('createToolCallTextSuppressor', () => {
  it('C41: preserves comparison prose containing a tool_call identifier', () => {
    const s = createToolCallTextSuppressor();
    const text = s.strip('x < tool_call.count && y > 0') + s.strip('; keep this explanation') + s.flush();
    expect(text).toBe('x < tool_call.count && y > 0; keep this explanation');
    expect(s.isSuppressing()).toBe(false);
  });

  it('suppresses a <tool_call>...</tool_call> block', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('a <tool_call>hidden</tool_call> b')).toBe('a  b');
  });

  it('suppresses an <edit>...</edit> block', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('a <edit>hidden</edit> b')).toBe('a  b');
  });

  it('handles a tool_call open tag split across calls', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('a <tool_c')).toBe('a ');
    expect(s.strip('all>hidden</tool_call> b')).toBe(' b');
  });

  it('handles a tool_call closing tag split across calls', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('<tool_call>hidden</tool_c')).toBe('');
    expect(s.isSuppressing()).toBe(true);
    expect(s.strip('all>after')).toBe('after');
    expect(s.isSuppressing()).toBe(false);
  });

  it('handles an edit closing tag split across calls', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('<edit>hidden</ed')).toBe('');
    expect(s.strip('it>after')).toBe('after');
  });

  it('treats a longer-than-canonical prefix (e.g. "<toolcallzzz") as a possible open candidate', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('before <toolcallzzz')).toBe('before ');
    expect(s.hasPendingCandidate()).toBe(true);
  });

  it('does not arm suppression for a "<...>"-containing chunk that is not a real open tag', () => {
    const s = createToolCallTextSuppressor();
    expect(s.strip('price < 5 > done')).toBe('price < 5 > done');
    expect(s.hasPendingCandidate()).toBe(false);
  });

  it('does not treat a "<...>"-containing chunk as a possible close-tag prefix while suppressing', () => {
    const s = createToolCallTextSuppressor();
    s.strip('<tool_call>');
    expect(s.isSuppressing()).toBe(true);
    expect(s.strip('mid < 5 > text')).toBe('');
    expect(s.hasPendingCandidate()).toBe(false);
  });
});

describe('emitWithTextSuppressor', () => {
  it('forwards a text_delta event when visible text survives', () => {
    const s = createDsmlArtifactTextSuppressor();
    const onEvent = vi.fn();
    const emitted = emitWithTextSuppressor(s, onEvent, 'hello');
    expect(emitted).toBe(true);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'hello' });
  });

  it('does not forward an event when nothing survives suppression', () => {
    const s = createDsmlArtifactTextSuppressor();
    const onEvent = vi.fn();
    const emitted = emitWithTextSuppressor(s, onEvent, '<artifact>hidden');
    expect(emitted).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
