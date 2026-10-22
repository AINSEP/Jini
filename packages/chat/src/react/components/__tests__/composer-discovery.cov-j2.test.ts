import { describe, expect, it } from 'vitest';
import { replaceComposerSlashTrigger, resolveComposerSlashKeyAction } from '../composer-discovery.js';

describe('replaceComposerSlashTrigger', () => {
  it('replaces a whole-draft slash token with the insert text', () => {
    expect(replaceComposerSlashTrigger({ draft: '/mcp supa', insertText: '/mcp supabase ' })).toBe('/mcp supabase ');
  });

  it('leaves a draft that is not a slash token untouched', () => {
    expect(replaceComposerSlashTrigger({ draft: 'hello /mcp', insertText: '/mcp ' })).toBe('hello /mcp');
  });
});

describe('resolveComposerSlashKeyAction', () => {
  it.each([
    [{ key: 'ArrowDown', shiftKey: false }, { type: 'move', offset: 1 }],
    [{ key: 'ArrowUp', shiftKey: false }, { type: 'move', offset: -1 }],
    [{ key: 'Enter', shiftKey: false }, { type: 'select' }],
    [{ key: 'Tab', shiftKey: false }, { type: 'select' }],
    [{ key: 'Enter', shiftKey: true }, { type: 'none' }],
    [{ key: 'Escape', shiftKey: false }, { type: 'dismiss' }],
    [{ key: 'a', shiftKey: false }, { type: 'none' }],
  ] as const)('maps %o to %o', (input, expected) => {
    expect(resolveComposerSlashKeyAction(input)).toEqual(expected);
  });
});
