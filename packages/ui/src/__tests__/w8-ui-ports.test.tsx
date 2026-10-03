// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDismissOnOutsideOrEscape } from '../browser/useDismissOnOutsideOrEscape.js';
import type { DismissSubscriptionPort } from '../browser/useDismissOnOutsideOrEscape.js';
import { resolveGlobalKeydownTarget, useGlobalKeydown } from '../browser/useGlobalKeydown.js';
import { useBrandFonts } from '../react/hooks/useBrandFonts.js';
import { useDebouncedValue } from '../react/hooks/useDebouncedValue.js';
import type { DebounceSchedulerPort } from '../react/hooks/useDebouncedValue.js';
import { copyToClipboard } from '../utils/copy-to-clipboard.js';

describe('object arguments and injected ui ports', () => {
  it('writes through an injected clipboard without touching browser globals', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await expect(copyToClipboard({ text: 'copied' }, { clipboard })).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith({ text: 'copied' });
  });

  it('uses the injected document for fallback and restores its prior focus', async () => {
    const focus = vi.fn();
    const prior = { isConnected: true, focus };
    const textarea = { value: '', style: {}, select: vi.fn() };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const document = {
      activeElement: prior,
      createElement: vi.fn(() => textarea),
      body: { appendChild, removeChild },
      execCommand: vi.fn(() => true),
    } as unknown as Document;
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error('locked')) };
    const isHTMLElement = vi.fn(() => true);

    await expect(copyToClipboard({ text: 'fallback' }, { clipboard, document, isHTMLElement })).resolves.toBe(true);
    expect(textarea.value).toBe('fallback');
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(removeChild).toHaveBeenCalledWith(textarea);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(isHTMLElement).toHaveBeenCalledWith({ value: prior });
  });

  it('cancels replaced debounce work and commits only when the scheduler fires', () => {
    const jobs: Array<{ callback: () => void; delayMs: number; cancel: ReturnType<typeof vi.fn> }> = [];
    const scheduler: DebounceSchedulerPort = {
      schedule: ({ callback, delayMs }) => {
        const cancel = vi.fn();
        jobs.push({ callback, delayMs, cancel });
        return cancel;
      },
    };
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue({ value, delayMs: 250 }, { scheduler }),
      { initialProps: { value: 'first' } },
    );
    rerender({ value: 'second' });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.cancel).toHaveBeenCalledOnce();
    expect(jobs[1]!.delayMs).toBe(250);
    expect(result.current).toBe('first');
    act(() => jobs[1]!.callback());
    expect(result.current).toBe('second');
    unmount();
    expect(jobs[1]!.cancel).toHaveBeenCalledOnce();
  });

  it('keeps a subscription stable while its latest dismissal callback changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn<DismissSubscriptionPort['subscribe']>(() => unsubscribe);
    const subscription: DismissSubscriptionPort = { subscribe };
    const { rerender, unmount } = renderHook(
      ({ onDismiss }) => useDismissOnOutsideOrEscape({ onDismiss }, { subscription }),
      { initialProps: { onDismiss: first } },
    );
    const args = subscribe.mock.calls[0]![0];
    expect(args.containerRef).toBeUndefined();
    args.onDismiss();
    expect(first).toHaveBeenCalledOnce();
    rerender({ onDismiss: second });
    args.onDismiss();
    expect(second).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('resolves injected keydown targets and handles an unavailable target', () => {
    const eventTarget = new EventTarget();
    expect(resolveGlobalKeydownTarget({ target: 'document' }, { globals: { document: eventTarget } })).toBe(eventTarget);
    expect(resolveGlobalKeydownTarget({ target: 'window' }, { globals: {} })).toBeUndefined();
    const handler = vi.fn();
    const resolveTarget = vi.fn(() => eventTarget);
    const { unmount } = renderHook(() => useGlobalKeydown({ handler }, { resolveTarget, capture: true }));
    expect(resolveTarget).toHaveBeenCalledWith({ target: 'window' });
    const event = new KeyboardEvent('keydown', { key: 'a' });
    eventTarget.dispatchEvent(event);
    expect(handler).toHaveBeenCalledWith(event);
    unmount();
    eventTarget.dispatchEvent(event);
    expect(handler).toHaveBeenCalledOnce();
    renderHook(() => useGlobalKeydown({ handler }, { resolveTarget: () => undefined }));
  });

  it('loads font assets through object ports into the injected document and cleans up', async () => {
    const isolatedDocument = document.implementation.createHTMLDocument('fonts');
    const resolveProjectAssetUrl = vi.fn(({ projectId, path }: { projectId: string; path: string }) =>
      `/assets/${projectId}/${path}`,
    );
    const manifest = {
      load: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ files: [{ family: 'Test', weight: '400', style: 'normal', file: 'test.woff2', format: 'woff2' }] }),
      }),
    };
    const { unmount } = renderHook(() => useBrandFonts(
      { fonts: [{ googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' }] },
      { projectId: 'project', resolveProjectAssetUrl, manifest, document: isolatedDocument },
    ));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(manifest.load).toHaveBeenCalledWith({ url: '/assets/project/fonts/manifest.json' });
    expect(resolveProjectAssetUrl).toHaveBeenCalledWith({ projectId: 'project', path: 'fonts/test.woff2' });
    expect(isolatedDocument.querySelectorAll('link')).toHaveLength(1);
    expect(isolatedDocument.querySelector('style')!.textContent).toContain("url('/assets/project/fonts/test.woff2')");
    unmount();
    expect(isolatedDocument.querySelectorAll('link, style')).toHaveLength(0);
  });
});
