import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLexicalWrapper } from './lexical-harness.js';

describe('makeLexicalWrapper (test-only harness)', () => {
  it('throws if getEditor() is called before the wrapper has rendered', () => {
    const { getEditor } = makeLexicalWrapper();
    expect(() => getEditor()).toThrow(/editor not captured yet/);
  });

  it('captures the real editor once the wrapper renders', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    render(wrapper({ children: null }));
    expect(getEditor()).toBeDefined();
    expect(typeof getEditor().update).toBe('function');
  });

  it('accepts a custom namespace', () => {
    const { wrapper, getEditor } = makeLexicalWrapper('my-namespace');
    renderHook(() => null, { wrapper });
    expect(getEditor()).toBeDefined();
  });

  it('rethrows a genuine internal Lexical error via onError', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => null, { wrapper });
    const editor = getEditor();
    expect(() => {
      editor.update(
        () => {
          throw new Error('boom');
        },
        { discrete: true },
      );
    }).toThrow('boom');
  });
});
