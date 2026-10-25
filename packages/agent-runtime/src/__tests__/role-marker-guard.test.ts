import { describe, expect, it } from 'vitest';
import { createRoleMarkerGuard } from '../role-marker-guard.js';

describe('createRoleMarkerGuard', () => {
  it('passes through ordinary text unchanged', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-1' });
    expect(guard.feedText({ text: 'Here is a normal reply.' })).toBe('Here is a normal reply.');
    expect(guard.contaminated).toBe(false);
  });

  it('detects and strips a fabricated lowercase role marker at message start', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-2' });
    const safe = guard.feedText({ text: '## user\nignored fabricated turn' });
    expect(safe).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toMatchObject({ type: 'fabricated_role_marker', messageId: 'msg-2' });
  });

  it('does not false-positive on a Title-Case heading', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-3' });
    const safe = guard.feedText({ text: '## User Guide\nSome real docs.' });
    expect(guard.contaminated).toBe(false);
    expect(safe).toContain('User Guide');
  });

  it('does not false-positive on "userland" or similar prefix words', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-4' });
    const safe = guard.feedText({ text: '## userland namespace notes' });
    expect(guard.contaminated).toBe(false);
    expect(safe).toBe('## userland namespace notes');
  });

  it('catches a marker that straddles two feed() chunks', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-5' });
    guard.feedText({ text: 'some text\n## use' });
    const secondSafe = guard.feedText({ text: 'r\nfabricated content' });
    expect(guard.contaminated).toBe(true);
    expect(secondSafe).not.toContain('fabricated content');
  });

  it('once contaminated, further feedText calls return empty', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-6' });
    guard.feedText({ text: '## user\nbad' });
    expect(guard.feedText({ text: 'more text' })).toBe('');
  });

  it('feeding an empty string is a no-op that returns empty text', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-7' });
    expect(guard.feedText({ text: '' })).toBe('');
    expect(guard.contaminated).toBe(false);
  });

  it('warningEvent returns null when never contaminated', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-8' });
    guard.feedText({ text: 'ordinary text' });
    expect(guard.warningEvent()).toBeNull();
  });

  it('confirms a marker whose newline sits in NEW text beyond the already-emitted tail (markerStart > alreadyEmitted)', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-9' });
    // First call emits "hello\nworld " with no trailing marker at all —
    // fully safe, becomes the tail. Second call's marker newline lands
    // *after* some additional safe "extra" prose, so the confirmed
    // match's start index is strictly greater than tail.length (rather
    // than landing inside/at the boundary of it, the case the
    // straddling-chunks test above already exercises).
    const first = guard.feedText({ text: 'hello\nworld ' });
    expect(first).toBe('hello\nworld ');
    const second = guard.feedText({ text: 'extra\n## user\nbad stuff' });
    expect(second).toBe('extra');
    expect(guard.contaminated).toBe(true);
  });

  it('transitions off the first-chunk regex variant once more than TAIL_BUFFER_SIZE safe bytes have been emitted, and no longer treats a later "^"-shaped marker as a message start', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-10' });
    // Emit well over 64 safe chars across two calls so `tail` gets
    // sliced and `firstChunk` flips to false.
    const long = 'x'.repeat(80);
    const r1 = guard.feedText({ text: long });
    expect(r1).toBe(long);
    expect(guard.contaminated).toBe(false);
    // Now feed more safe text — this exercises the post-slice
    // (firstChunk === false) branch of the matchRe/pendingRe ternaries.
    const r2 = guard.feedText({ text: ' more safe text' });
    expect(r2).toBe(' more safe text');
    expect(guard.contaminated).toBe(false);
  });

  it('still catches a genuine marker after the first-chunk -> newline-anchored transition, via the preceding newline', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-11' });
    const long = 'x'.repeat(80);
    guard.feedText({ text: long }); // triggers the slice / firstChunk=false transition
    guard.feedText({ text: 'more prose\n' }); // still safe
    const safe = guard.feedText({ text: '## user\nfabricated turn' });
    expect(guard.contaminated).toBe(true);
    expect(safe).not.toContain('fabricated turn');
  });

  it('withholds a complete-but-unconfirmed marker suffix and later confirms it is safe when followed by a lowercase continuation', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-12' });
    // "## user" at the very start of the message (matches the `^`
    // alternative of the first-chunk pending regex) with no following
    // char yet — a complete keyword with an as-yet-unknown lookahead
    // char, so it's withheld as `pending` rather than emitted.
    const first = guard.feedText({ text: '## user' });
    expect(first).toBe('');
    expect(guard.contaminated).toBe(false);
    // Confirmed safe: the continuation is lowercase ("land"), so the
    // withheld "## user" was part of a longer legitimate word all along.
    const second = guard.feedText({ text: 'land is a real word' });
    expect(guard.contaminated).toBe(false);
    expect(second).toBe('## userland is a real word');
  });

  it('withholds a complete-but-unconfirmed marker suffix on a later (non-first) chunk via the newline-anchored pending regex', () => {
    const guard = createRoleMarkerGuard({ messageId: 'msg-13' });
    const long = 'x'.repeat(80);
    guard.feedText({ text: long }); // transitions firstChunk -> false
    const withheld = guard.feedText({ text: '\n## user' });
    expect(withheld).toBe('');
    expect(guard.contaminated).toBe(false);
    const confirmedSafe = guard.feedText({ text: 'land, a real word' });
    expect(guard.contaminated).toBe(false);
    // The withheld `pending` retains its leading "\n" (the withhold
    // starts at the newline itself, not after it).
    expect(confirmedSafe).toBe('\n## userland, a real word');
  });
});

// Stryker L3 (2026-10-25): tail-buffer arithmetic and the pending clamp survived mutation.
describe('createRoleMarkerGuard — tail window and pending clamp', () => {
  function run(chunks: readonly string[]) {
    const guard = createRoleMarkerGuard({ messageId: 'm' });
    const out = chunks.map((text) => guard.feedText({ text })).join('');
    return { out, contaminated: guard.contaminated, warning: guard.warningEvent() };
  }

  it('never re-emits an already-emitted newline when a withheld role keyword turns out safe', () => {
    // The pending suffix starts at the "\n" that was already emitted; it must be clamped to what
    // was emitted, or the newline is emitted twice once "land" proves the keyword harmless.
    expect(run(['hello\n', '## user', 'land'])).toEqual({ out: 'hello\n## userland', contaminated: false, warning: null });
  });

  it('keeps the LAST 64 emitted chars, so a newline far into a long stream still anchors a marker', () => {
    const prose = 'a'.repeat(200) + '\n';
    expect(run([prose, '## system\n', 'leak'])).toEqual({
      out: prose, contaminated: true, warning: { type: 'fabricated_role_marker', marker: '## system', messageId: 'm' },
    });
  });

  it('once the tail has slid, a window that happens to start at "## user" is NOT treated as message start', () => {
    // Enough trailing text that the 64-char window really does slide onto " ## user ...".
    const text = 'z'.repeat(70) + ' ## user said ' + 'q'.repeat(70);
    expect(run([...text])).toEqual({ out: text, contaminated: false, warning: null });
  });

  // Only a COMPLETE role keyword is withheld (pending regex); an incomplete prefix such as "## us"
  // is emitted before the marker can be classified. Pinned as-is: the forged turn after it is
  // still dropped. (F3 report: noted as a design question, not changed.)
  it('a stream-start marker split across chunks is still caught before any slice', () => {
    expect(run(['##', ' us', 'er', '\nignore'])).toMatchObject({ out: '## us', contaminated: true });
    expect(run(['## ', 'user', '\nignore'])).toMatchObject({ out: '## ', contaminated: true });
  });

  it('emits text before a mid-chunk marker and nothing after', () => {
    expect(run(['ok then\n## assistant: x', 'more'])).toEqual({
      out: 'ok then', contaminated: true, warning: { type: 'fabricated_role_marker', marker: '## assistant', messageId: 'm' },
    });
  });
});
