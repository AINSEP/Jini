// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBrandFonts } from '../useBrandFonts.js';

function flushMicrotasks() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => el.remove());
  document.querySelectorAll('style[data-brand-fonts]').forEach((el) => el.remove());
});

describe('useBrandFonts — Google Fonts stylesheet injection', () => {
  it('injects a <link> for each valid Google Fonts URL and dedupes duplicates', () => {
    renderHook(() =>
      useBrandFonts(undefined, [
        { googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' },
        { googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' },
        { googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Roboto' },
      ]),
    );
    const links = document.head.querySelectorAll('link[rel="stylesheet"]');
    expect(links).toHaveLength(2);
  });

  it('filters out non-googleapis and empty font URLs', () => {
    renderHook(() =>
      useBrandFonts(undefined, [
        { googleFontsUrl: 'https://evil.example/css2?family=Inter' },
        {},
      ]),
    );
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
  });

  it('removes the injected links when the font list changes', () => {
    const { rerender } = renderHook(({ fonts }) => useBrandFonts(undefined, fonts), {
      initialProps: { fonts: [{ googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' }] },
    });
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);

    rerender({ fonts: [] });
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
  });

  it('removes the injected links on unmount', () => {
    const { unmount } = renderHook(() =>
      useBrandFonts(undefined, [{ googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' }]),
    );
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
    unmount();
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
  });
});

describe('useBrandFonts — self-hosted font manifest', () => {
  it('skips the manifest fetch entirely when no resolveProjectAssetUrl is supplied', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderHook(() => useBrandFonts('proj-1', []));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the manifest fetch entirely when no projectId is supplied', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderHook(() => useBrandFonts(undefined, [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the manifest via the injected resolver and injects @font-face rules', async () => {
    const resolveProjectAssetUrl = vi.fn((id: string, path: string) => `/assets/${id}/${path}`);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        files: [
          { family: "O'Brien Sans", weight: '400', style: 'normal', file: 'obrien.woff2', format: 'woff2' },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    renderHook(() => useBrandFonts('proj-1', [], { resolveProjectAssetUrl }));
    await flushMicrotasks();

    // fetchWithTimeout composes its own timeout AbortSignal in — see fetch-with-timeout.ts.
    expect(fetchSpy).toHaveBeenCalledWith('/assets/proj-1/fonts/manifest.json', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(resolveProjectAssetUrl).toHaveBeenCalledWith('proj-1', 'fonts/manifest.json');
    expect(resolveProjectAssetUrl).toHaveBeenCalledWith('proj-1', 'fonts/obrien.woff2');

    const styleEl = document.head.querySelector('style[data-brand-fonts="proj-1"]');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain("font-family: 'OBrien Sans'");
    expect(styleEl!.textContent).toContain("src: url('/assets/proj-1/fonts/obrien.woff2') format('woff2')");
    expect(styleEl!.textContent).toContain('font-weight: 400');
    expect(styleEl!.textContent).toContain('font-style: normal');
  });

  it('does not inject a style element when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    renderHook(() =>
      useBrandFonts('proj-1', [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }),
    );
    await flushMicrotasks();
    expect(document.head.querySelector('style[data-brand-fonts]')).toBeNull();
  });

  it('does not inject a style element when the manifest has no files', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) })));
    renderHook(() =>
      useBrandFonts('proj-1', [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }),
    );
    await flushMicrotasks();
    expect(document.head.querySelector('style[data-brand-fonts]')).toBeNull();
  });

  it('does not inject a style element when the manifest response is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    renderHook(() =>
      useBrandFonts('proj-1', [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }),
    );
    await flushMicrotasks();
    expect(document.head.querySelector('style[data-brand-fonts]')).toBeNull();
  });

  it('swallows a fetch rejection (a missing/malformed manifest is expected for some systems)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    renderHook(() =>
      useBrandFonts('proj-1', [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }),
    );
    await flushMicrotasks();
    expect(document.head.querySelector('style[data-brand-fonts]')).toBeNull();
  });

  it('removes the injected style element on unmount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          files: [{ family: 'Inter', weight: '400', style: 'normal', file: 'inter.woff2', format: 'woff2' }],
        }),
      })),
    );
    const { unmount } = renderHook(() =>
      useBrandFonts('proj-1', [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }),
    );
    await flushMicrotasks();
    expect(document.head.querySelector('style[data-brand-fonts]')).not.toBeNull();
    unmount();
    expect(document.head.querySelector('style[data-brand-fonts]')).toBeNull();
  });

  it('does not inject a style element when unmounted before the fetch resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const { unmount } = renderHook(() =>
      useBrandFonts('proj-1', [], { resolveProjectAssetUrl: (id, path) => `/assets/${id}/${path}` }),
    );
    unmount();
    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({
          files: [{ family: 'Inter', weight: '400', style: 'normal', file: 'inter.woff2', format: 'woff2' }],
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.head.querySelector('style[data-brand-fonts]')).toBeNull();
  });

  it('re-fetches when projectId or the resolver identity changes', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const resolveProjectAssetUrl = (id: string, path: string) => `/assets/${id}/${path}`;
    const { rerender } = renderHook(
      ({ projectId }) => useBrandFonts(projectId, [], { resolveProjectAssetUrl }),
      { initialProps: { projectId: 'proj-1' } },
    );
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    rerender({ projectId: 'proj-2' });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith('/assets/proj-2/fonts/manifest.json', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });
});
