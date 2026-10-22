import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDebouncedHtmlPreview, type HtmlPreviewPort } from '../components/useDebouncedHtmlPreview.hooks.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('waits 400ms after the latest source change, including equal source values', async () => {
  const calls: string[] = [];
  const render: HtmlPreviewPort = async ({ source }) => { calls.push(source); return `<p>${source}</p>`; };
  const hook = renderHook(({ source }) => useDebouncedHtmlPreview({ source, render }), { initialProps: { source: 'first' } });
  expect(hook.result.current).toEqual({ document: '', loading: true, error: null });
  await act(() => vi.advanceTimersByTimeAsync(399));
  expect(calls).toEqual([]);
  hook.rerender({ source: 'second' });
  await act(() => vi.advanceTimersByTimeAsync(399));
  expect(calls).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(calls).toEqual(['second']);
  expect(hook.result.current).toEqual({ document: '<p>second</p>', loading: false, error: null });
  hook.rerender({ source: 'second' });
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(calls).toEqual(['second']);
});

it('aborts the old request and ignores both its late success and its late failure', async () => {
  const pending: Array<{ resolve: (html: string) => void; reject: (error: Error) => void; signal: AbortSignal }> = [];
  const render: HtmlPreviewPort = (_input, { signal }) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal }));
  const hook = renderHook(({ source }) => useDebouncedHtmlPreview({ source, render }), { initialProps: { source: 'one' } });
  await act(() => vi.advanceTimersByTimeAsync(400));
  hook.rerender({ source: 'two' });
  expect(pending[0]!.signal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(400));
  hook.rerender({ source: 'three' });
  await act(() => vi.advanceTimersByTimeAsync(400));
  await act(async () => pending[2]!.resolve('<p>newest</p>'));
  await act(async () => pending[0]!.resolve('<p>stale</p>'));
  await act(async () => pending[1]!.reject(new Error('stale failure')));
  expect(hook.result.current).toEqual({ document: '<p>newest</p>', loading: false, error: null });
  hook.unmount();
  expect(pending[2]!.signal.aborted).toBe(true);
});

it('shows one short error, recovers, and reloads for a revision change', async () => {
  let fail = true;
  const render: HtmlPreviewPort = () => { if (fail) throw new Error('private server detail'); return Promise.resolve('<p>recovered</p>'); };
  const hook = renderHook(({ revision }) => useDebouncedHtmlPreview({ source: 'same', render }, { revision }), { initialProps: { revision: 'before' } });
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(hook.result.current).toEqual({ document: '', loading: false, error: 'Preview unavailable.' });
  fail = false;
  hook.rerender({ revision: 'after' });
  expect(hook.result.current.error).toBe(null);
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(hook.result.current).toEqual({ document: '<p>recovered</p>', loading: false, error: null });
});

it('cancels the debounce timer on unmount', async () => {
  const calls: string[] = [];
  const render: HtmlPreviewPort = async ({ source }) => { calls.push(source); return source; };
  const hook = renderHook(() => useDebouncedHtmlPreview({ source: 'never', render }));
  hook.unmount();
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(calls).toEqual([]);
});

it('schedules no extra render per edit while loading, so fast typing never trips the nested-update limit', async () => {
  const render: HtmlPreviewPort = async ({ source }) => source;
  let renders = 0;
  const hook = renderHook(({ source }) => { renders += 1; return useDebouncedHtmlPreview({ source, render }); }, { initialProps: { source: 'a' } });
  const before = renders;
  for (const source of ['ab', 'abc', 'abcd']) hook.rerender({ source });
  expect(hook.result.current).toEqual({ document: '', loading: true, error: null });
  expect(renders - before).toBe(3);
});
