import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCachedLoader, useFetchMutation, useFetchQuery, useInvalidate } from '../index.js';
import { useFetchQuery as useReactAdapterFetchQuery } from '../adapter.react.js';

afterEach(() => { vi.restoreAllMocks(); });

/** React logs the render error before rethrowing; keep the test output to the assertion. */
function quietRenderErrors() { vi.spyOn(console, 'error').mockImplementation(() => {}); }

describe('fetch-query hooks outside a provider', () => {
  it.each([
    ['useFetchQuery', () => useFetchQuery({ key: ['k'], fetch: async () => 1 })],
    ['useFetchMutation', () => useFetchMutation({ run: async () => 1 })],
    ['useCachedLoader', () => useCachedLoader({ key: ['k'], fetch: async () => 1 })],
    ['useInvalidate', () => useInvalidate()],
  ])('%s fails closed instead of reading or writing an unscoped cache', (_name, hook) => {
    quietRenderErrors();
    expect(() => renderHook(hook)).toThrow('Fetch-query hooks require FetchQueryProvider');
  });

  it('the plain-React adapter hooks fail closed the same way when used without their provider', () => {
    quietRenderErrors();
    expect(() => renderHook(() => useReactAdapterFetchQuery({ key: ['k'], fetch: async () => 1 }))).toThrow('Fetch-query hooks require FetchQueryProvider');
  });
});
