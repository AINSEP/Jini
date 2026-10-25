import { describe, expect, it, vi } from 'vitest';
import { describeDelegatedInternalError, mintToolErrorId, TOOL_ERROR_ID_PATTERN } from '../redaction.js';

// F1 fix wave (Stryker L8 §4 tool-recovery/redaction.ts:39 quantifiers/anchors, 107 reason
// fallbacks): one row per regex rule and per reason branch.
describe('TOOL_ERROR_ID_PATTERN', () => {
  it.each([
    ['ERR-0123-4567-89AB-CDEF', true],
    ['see Error ERR-0123-4567-89AB-CDEF: boom', true],
    ['ERR-0123-4567-89AB', false], // 3 groups
    ['ERR-0123-4567-89AB-CDEF-0000', true], // \b still matches the 4-group prefix
    ['ERR-012-4567-89AB-CDEF', false], // short group
    ['ERR-0123-4567-89ab-cdef', false], // lower-case hex
    ['ERR-0123-4567-89AB-CDEG', false], // non-hex
    ['XERR-0123-4567-89AB-CDEF', false], // leading word char (\b)
    ['ERR-0123-4567-89AB-CDEFX', false], // trailing word char (\b)
    ['ERR0123-4567-89AB-CDEF', false],
    ['', false],
  ])('%j → %s', (text, expected) => {
    expect(TOOL_ERROR_ID_PATTERN.test(text)).toBe(expected);
  });

  it('every minted id matches, from upper-cased host hex', () => {
    const id = mintToolErrorId({ randomHex: ({ bytes }) => 'ab'.repeat(bytes) });
    expect(id).toBe('ERR-ABAB-ABAB-ABAB-ABAB');
    expect(TOOL_ERROR_ID_PATTERN.test(id)).toBe(true);
  });
});

describe('describeDelegatedInternalError — reason branches', () => {
  const deps = () => ({ mintErrorId: () => 'ERR-0000-0000-0000-0001', redactSecretShapes: ({ text }: { text: string }) => ({ text, redactions: 0 }), onFailure: vi.fn() });
  const ctx = (extra: Record<string, unknown>) => ({ source: 'delegated', toolId: 'echo', runId: 'r', correlationId: 'c-1', ...extra }) as never;
  it.each<[string, Record<string, unknown>, string]>([
    ['timed-out', { status: 'timed-out', error: new Error('ignored') }, 'tool "echo" timed out before it finished'],
    ['cancelled', { status: 'cancelled' }, 'tool "echo" was cancelled before it finished (the run ended or the call was abandoned)'],
    ['Error with message', { error: new Error('disk full') }, 'disk full'],
    ['Error with EMPTY message', { error: new Error('') }, 'tool "echo" failed'],
    ['non-empty string', { error: 'plain reason' }, 'plain reason'],
    ['empty string', { error: '' }, 'tool "echo" failed'],
    ['object', { error: { message: 'not an Error' } }, 'tool "echo" failed'],
  ])('%s', (_l, extra, reason) => {
    const d = deps();
    expect(describeDelegatedInternalError({ context: ctx(extra), ...d })).toBe(`Error ERR-0000-0000-0000-0001: ${reason}`);
    expect(d.onFailure).toHaveBeenCalledWith({ errorId: 'ERR-0000-0000-0000-0001', toolId: 'echo', runId: 'r', principalId: '(unresolved)', executionId: '(none) correlationId=c-1', redactions: 0, message: reason });
  });
  it('a throwing failure sink never turns the description into a throw', () => {
    expect(describeDelegatedInternalError({ context: ctx({ error: 'x' }), ...deps(), onFailure: () => { throw new Error('sink'); } })).toBe('Error ERR-0000-0000-0000-0001: x');
  });
});
