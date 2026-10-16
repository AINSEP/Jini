/** Owner brief: shared warning behavior for site defaults and per-entry social images. */
import { act, renderHook, waitFor, render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { SeoEntrySection } from '../pages/SeoPage.js';
import type { SyntheticEvent } from 'react';
import { useMediaRefField } from '../hooks/MediaRefField.hooks.js';
import { MediaRefField } from '../components/MediaRefField.js';
import { SeoPortsContext, SeoOptionsContext } from '../hooks/SeoPorts.hooks.js';
import { createMemorySeoApi } from '../../adapters/memory.js';
import { createHttpSeoApi } from '../../adapters/http.js';
import type { AdminSeoPort } from '../../ports.js';
import { resolveMediaRefPreviewUrl, shareImageWarning } from '../../rules.js';

function api(inspect: NonNullable<AdminSeoPort['inspectShareImage']>): AdminSeoPort {
  return { ...createMemorySeoApi({ mediaOriginalUrl: ({ id }) => `/original/${id}` }), inspectShareImage: inspect };
}
function load(width: number, src = '/original/cover', height = 630): SyntheticEvent<HTMLImageElement> {
  const image = document.createElement('img');
  image.setAttribute('src', src);
  Object.defineProperty(image, 'naturalWidth', { value: width });
  Object.defineProperty(image, 'naturalHeight', { value: height });
  return { currentTarget: image } as SyntheticEvent<HTMLImageElement>;
}

test('empty or malformed share images explain why a preview may have no picture', () => {
  const { result, rerender } = renderHook(({ value }) => useMediaRefField({ value, onChange: () => {}, api: createMemorySeoApi() }), { initialProps: { value: '' } });
  expect(result.current.warning).toBe('No share image is selected. Link previews may show no picture.');
  rerender({ value: 'not-a-reference' });
  expect(result.current.warning).toBe('The share image reference is invalid. Choose an image or enter an absolute image URL.');
});

test.each([1199, 1200])('uses decoded source width at the 1200 px boundary (%i)', async width => {
  const port = api(async () => ({ status: 200, byteSize: 5120 }));
  const { result } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }));
  await waitFor(() => expect(result.current.warning).toBeNull());
  act(() => result.current.onPreviewLoad!(load(width)));
  expect(result.current.warning).toBe(width === 1199 ? 'The share image is only 1199 px wide; use an image at least 1200 px wide.' : null);
});

test.each([66, 5119, 5120])('checks real byte size independently of decoded width (%i)', async byteSize => {
  const port = api(async () => ({ status: 200, byteSize }));
  const { result } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }));
  act(() => result.current.onPreviewLoad!(load(1200)));
  await waitFor(() => expect(result.current.warning).toBe(byteSize < 5120 ? `The share image is only ${byteSize} bytes; use an image of at least 5 KB (5120 bytes).` : null));
});

test('a 66-byte placeholder explains both its tiny decoded width and tiny file size', async () => {
  const port = api(async () => ({ status: 200, byteSize: 66 }));
  const { result } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }));
  act(() => result.current.onPreviewLoad!(load(1)));
  await waitFor(() => expect(result.current.warning).toBe('The share image is only 1 px wide; use an image at least 1200 px wide. The share image is only 66 bytes; use an image of at least 5 KB (5120 bytes).'));
});

test.each([404, 410, 403])('reports the actual HTTP failure (%i)', async status => {
  const port = api(async () => ({ status, byteSize: 66 }));
  const { result } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }));
  await waitFor(() => expect(result.current.warning).toBe(status === 404 || status === 410 ? `The share image is missing (HTTP ${status}).` : `The share image could not be checked (HTTP ${status}).`));
});

test('request errors remain visible and missing length is not mistaken for a zero-byte image', async () => {
  const failure = api(async () => { throw new Error('Network offline'); });
  const { result, rerender } = renderHook(({ port }) => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }), { initialProps: { port: failure } });
  await waitFor(() => expect(result.current.warning).toBe('The share image could not be checked: Network offline'));
  rerender({ port: api(async () => ({ status: 200, byteSize: null })) });
  await waitFor(() => expect(result.current.warning).toBeNull());
  act(() => result.current.onPreviewError!(load(0)));
  expect(result.current.warning).toBe('The share image could not be loaded. Choose an available image.');
});

test('changing selection aborts the prior probe and ignores its late result and image event', async () => {
  let resolveFirst!: (value: { status: number; byteSize: number }) => void;
  let firstSignal: AbortSignal | undefined;
  const port = api(({ url }, { signal } = {}) => {
    if (url === '/original/cover') { firstSignal = signal; return new Promise(resolve => { resolveFirst = resolve; }); }
    return Promise.resolve({ status: 200, byteSize: 5120 });
  });
  const { result, rerender, unmount } = renderHook(({ value }) => useMediaRefField({ value, onChange: () => {}, api: port }), { initialProps: { value: 'cover:public' } });
  const oldLoad = result.current.onPreviewLoad!;
  rerender({ value: 'large:public' });
  expect(firstSignal!.aborted).toBe(true);
  await act(async () => { resolveFirst({ status: 404, byteSize: 66 }); });
  act(() => oldLoad(load(1, '/original/cover', 1)));
  expect(result.current.warning).toBeNull();
  unmount();
});

test('resolved local share URLs preview the original source, so upscaling cannot hide a placeholder', () => {
  expect(resolveMediaRefPreviewUrl({ value: 'https://site.test/m/cover/og.v2/image.jpg', mediaOriginalUrl: id => `/original/${id}` }, { siteOrigin: 'https://site.test' })).toBe('/original/cover');
  expect(resolveMediaRefPreviewUrl({ value: 'https://external.test/m/cover/og.v2/image.jpg', mediaOriginalUrl: id => `/original/${id}` }, { siteOrigin: 'https://site.test' })).toBe('https://external.test/m/cover/og.v2/image.jpg');
});

test('HTTP inspection keeps absent Content-Length unknown and passes the cancellation signal', async () => {
  const reads: unknown[] = [];
  const port = createHttpSeoApi({ transport: { request: async () => { throw new Error('unused'); }, url: ({ path }) => path }, basePath: '/w' }, { imageTransport: { head: async (input, options) => { reads.push([input, options]); return { status: 200, headers: new Headers() }; } } });
  const signal = new AbortController().signal;
  expect(await port.inspectShareImage!({ url: '/original/cover' }, { signal })).toEqual({ status: 200, byteSize: null });
  expect(reads).toEqual([[{ url: '/original/cover' }, { signal }]]);
});

// Owner, 2026-10-15: the yellow callout under every image was "completely useless". The hook keeps
// computing it (covered above); the shared field no longer paints it.
test.each(['seo-default-og-image', 'seo-entry-og-image', 'seo-entry-twitter-image'])('does not paint the warning beside %s', async id => {
  const inspected: string[] = [];
  const port = api(async ({ url }) => { inspected.push(url); return { status: 200, byteSize: 66 }; });
  render(<SeoPortsContext.Provider value={{ seoApi: port }}><SeoOptionsContext.Provider value={{ siteUrl: () => 'https://site.test', t: key => key }}><MediaRefField locale="en" id={id} label="Share image" value="cover:public" onChange={() => {}} /></SeoOptionsContext.Provider></SeoPortsContext.Provider>);
  await waitFor(() => expect(inspected).toEqual(['/original/cover']));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByLabelText('Share image').hasAttribute('aria-describedby')).toBe(false);
  expect(screen.getByAltText('Share image preview')).toBeTruthy();
});

test.each(['https://external.test/cover.png', '//external.test/cover.png'])('external image %s skips the CORS-sensitive HEAD while retaining decoded-width diagnostics', async value => {
  let requests = 0;
  const port = api(async () => { requests++; throw new Error('CORS blocked'); });
  const { result } = renderHook(() => useMediaRefField({ value, onChange: () => {}, api: port }));
  await act(async () => {});
  expect(requests).toBe(0);
  expect(result.current.warning).toBeNull();
  act(() => result.current.onPreviewLoad!(load(1199, value)));
  expect(result.current.warning).toBe('The share image is only 1199 px wide; use an image at least 1200 px wide.');
  act(() => result.current.onPreviewError!(load(0, value)));
  expect(result.current.warning).toBe('The share image could not be loaded. Choose an available image.');
});

test('absolute same-origin previews still report a missing file', async () => {
  const value = `${globalThis.location.origin}/cover.png`;
  const inspected: string[] = [];
  const port = api(async ({ url }) => { inspected.push(url); return { status: 404, byteSize: null }; });
  const { result } = renderHook(() => useMediaRefField({ value, onChange: () => {}, api: port }));
  await waitFor(() => expect(result.current.warning).toBe('The share image is missing (HTTP 404).'));
  expect(inspected).toEqual([value]);
});

test('warning policy translates each explanation with stable keys and measured variables', () => {
  const translations: Record<string, string> = {
    'No share image is selected. Link previews may show no picture.': 'Sin imagen.',
    'The share image reference is invalid. Choose an image or enter an absolute image URL.': 'Referencia inválida.',
    'The share image could not be loaded. Choose an available image.': 'Imagen no disponible.',
    'The share image is only {width} px wide; use an image at least 1200 px wide.': 'Ancho: {width} px.',
    'The share image is only {height} px tall; use an image at least 630 px tall.': 'Alto: {height} px.',
    'The share image is only {byteSize} bytes; use an image of at least 5 KB (5120 bytes).': 'Tamaño: {byteSize} bytes.',
  };
  const options = { t: (key: string) => translations[key] ?? key };
  expect(shareImageWarning({ value: '', previewUrl: null }, options)).toBe('Sin imagen.');
  expect(shareImageWarning({ value: 'bad', previewUrl: null }, options)).toBe('Referencia inválida.');
  expect(shareImageWarning({ value: 'cover:public', previewUrl: '/cover', previewFailed: true }, options)).toBe('Imagen no disponible.');
  expect(shareImageWarning({ value: 'cover:public', previewUrl: '/cover', width: 1199, height: 629, byteSize: 66 }, options)).toBe('Ancho: 1199 px. Alto: 629 px. Tamaño: 66 bytes.');
});

test('wired fields translate HTTP failures and update copy when the host translator changes', async () => {
  const port = api(async () => ({ status: 404, byteSize: null }));
  const key = 'The share image is missing (HTTP {status}).';
  const { result, rerender } = renderHook(({ copy }) => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }, { t: text => text === key ? copy : text }), { initialProps: { copy: 'Ausente (HTTP {status}).' } });
  await waitFor(() => expect(result.current.warning).toBe('Ausente (HTTP 404).'));
  rerender({ copy: 'Fehlt (HTTP {status}).' });
  expect(result.current.warning).toBe('Fehlt (HTTP 404).');
});

test.each([
  { inspect: async () => ({ status: 403, byteSize: null }), key: 'The share image could not be checked (HTTP {status}).', copy: 'Prüfung (HTTP {status}).', expected: 'Prüfung (HTTP 403).' },
  { inspect: async (): Promise<{ status: number; byteSize: null }> => { throw new Error('Network offline'); }, key: 'The share image could not be checked: {detail}', copy: 'Prüfung: {detail}', expected: 'Prüfung: Network offline' },
])('translates failed probes with their actual HTTP or network reason: $expected', async ({ inspect, key, copy, expected }) => {
  const port = api(inspect);
  const { result } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }, { t: text => text === key ? copy : text }));
  await waitFor(() => expect(result.current.warning).toBe(expected));
});

test('a pending image check translates its timeout reason and cancels its request', () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const port = api((_input, options) => { signal = options?.signal; return new Promise(() => {}); });
  const { result, unmount } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }, {
    t: key => key === 'The share image check timed out after 10 seconds.' ? 'Zeitüberschreitung nach 10 Sekunden.' : key,
  }));
  try {
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(signal!.aborted).toBe(true);
    expect(result.current.warning).toBe('Zeitüberschreitung nach 10 Sekunden.');
  } finally { unmount(); vi.useRealTimers(); }
});

test('reloaded entry fields inspect the source reference even when the public rendition has a different host', async () => {
  const meta = {
    title: 'Page', canonical: 'https://public-alias.test/page', robots: { noindex: false, nofollow: false }, jsonLd: [],
    openGraph: { title: 'Page', type: 'website' as const, url: 'https://public-alias.test/page', image: 'https://public-alias.test/m/cover/og.v1/image.jpg', imageRef: 'cover:public' },
    twitter: { title: 'Page', card: 'summary_large_image' as const, image: 'https://public-alias.test/m/cover/og.v1/image.jpg', imageRef: 'cover:public' },
  };
  const inspected: string[] = [];
  const port: AdminSeoPort = {
    ...createMemorySeoApi({ entries: { page: { meta, analysis: { entryId: 'page', score: 100, issues: [], resolved: meta } } }, mediaOriginalUrl: ({ id }) => `/original/${id}` }),
    inspectShareImage: async ({ url }) => { inspected.push(url); return { status: 200, byteSize: 66 }; },
  };
  render(<FetchQueryProvider><SeoPortsContext.Provider value={{ seoApi: port }}><SeoOptionsContext.Provider value={{ siteUrl: () => 'https://admin.test', t: key => key }}><SeoEntrySection locale="en" useSeoEntrySectionHook={() => ({ entryId: 'page', setEntryId: () => {} })} /></SeoOptionsContext.Provider></SeoPortsContext.Provider></FetchQueryProvider>);
  await waitFor(() => expect(inspected).toEqual(['/original/cover', '/original/cover']));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByAltText('OG image preview').getAttribute('src')).toBe('/original/cover');
  expect(screen.getByAltText('Twitter image preview').getAttribute('src')).toBe('/original/cover');
});

test.each([629, 630])('checks decoded height independently at the 630 px boundary (%i)', async height => {
  const port = api(async () => ({ status: 200, byteSize: 5120 }));
  const { result } = renderHook(() => useMediaRefField({ value: 'cover:public', onChange: () => {}, api: port }));
  await waitFor(() => expect(result.current.warning).toBeNull());
  act(() => result.current.onPreviewLoad!(load(1200, '/original/cover', height)));
  expect(result.current.warning).toBe(height === 629 ? 'The share image is only 629 px tall; use an image at least 630 px tall.' : null);
});

test('unknown dimensions stay unknown while either measured undersized dimension warns', () => {
  const selected = { value: 'cover:public', previewUrl: '/original/cover' };
  expect(shareImageWarning(selected)).toBeNull();
  expect(shareImageWarning({ ...selected, width: 1200 })).toBeNull();
  expect(shareImageWarning({ ...selected, height: 630 })).toBeNull();
  expect(shareImageWarning({ ...selected, height: 629 })).toBe('The share image is only 629 px tall; use an image at least 630 px tall.');
  expect(shareImageWarning({ ...selected, width: 1199 })).toBe('The share image is only 1199 px wide; use an image at least 1200 px wide.');
});

test('wired decoded dimensions use the original even when the public rendition is upscaled', async () => {
  const port = api(async () => ({ status: 200, byteSize: 5120 }));
  const value = `${globalThis.location.origin}/m/cover/og.v2/image.jpg`;
  port.mediaPreviewUrl = ({ value }) => resolveMediaRefPreviewUrl({ value, mediaOriginalUrl: id => `/original/${id}` }, { siteOrigin: globalThis.location.origin });
  const { result } = renderHook(() => useMediaRefField({ value, onChange: () => {}, api: port }, {
    t: key => key === 'The share image is only {height} px tall; use an image at least 630 px tall.' ? 'Alto: {height} px.' : key,
  }));
  expect(result.current.previewUrl).toBe('/original/cover');
  await waitFor(() => expect(result.current.warning).toBeNull());
  // A rendition's late event is not a measurement of the source selected by this field.
  act(() => result.current.onPreviewLoad!(load(1200, value, 630)));
  expect(result.current.warning).toBeNull();
  act(() => result.current.onPreviewLoad!(load(1200, '/original/cover', 629)));
  expect(result.current.warning).toBe('Alto: 629 px.');
});
