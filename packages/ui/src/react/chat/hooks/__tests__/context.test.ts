import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnalytics, useArtifactRegistry, useChatTransport, useI18n, useProjectContext, useT } from '../context.js';

describe('context (standalone, no <JiniChatProvider> mounted)', () => {
  it('useT() passthrough returns the key unchanged when no vars are given', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('Answered')).toBe('Answered');
  });

  it('useT() passthrough interpolates {placeholders} found in vars, and leaves unmatched ones literal', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('Hello {name}, you have {count} items', { name: 'Ada', count: 3 })).toBe('Hello Ada, you have 3 items');
    // "missing" has no entry in vars — the literal placeholder must survive untouched.
    expect(result.current('Hello {missing}', { name: 'Ada' })).toBe('Hello {missing}');
  });

  it('useI18n() returns the full passthrough adapter (t + locale)', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.locale).toBe('en');
    expect(result.current.t('x')).toBe('x');
  });

  it('useAnalytics() default is a no-op track() that does not throw', () => {
    const { result } = renderHook(() => useAnalytics());
    expect(() => result.current.track('clicked', { id: '1' })).not.toThrow();
  });

  it('useProjectContext() is undefined with no provider mounted', () => {
    const { result } = renderHook(() => useProjectContext());
    expect(result.current).toBeUndefined();
  });

  it('useArtifactRegistry() is undefined with no provider mounted', () => {
    const { result } = renderHook(() => useArtifactRegistry());
    expect(result.current).toBeUndefined();
  });

  it('useChatTransport() throws with no provider mounted', () => {
    const { result } = renderHook(() => {
      try {
        return { transport: useChatTransport(), error: null };
      } catch (err) {
        return { transport: null, error: err as Error };
      }
    });
    expect(result.current.transport).toBeNull();
    expect(result.current.error?.message).toContain('useChatTransport() must be called within <JiniChatProvider transport={...}>');
  });
});
