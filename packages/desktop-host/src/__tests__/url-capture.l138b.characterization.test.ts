import { describe, expect, it } from 'vitest';
import { readUrlCaptureRequest, type UrlCaptureRequest } from '../url-capture.js';

const request: UrlCaptureRequest = {
  url: 'https://site.example/', viewport: { width: 1280, height: 1024 },
  fullPage: false, maxPageHeightPx: 8000, settleMs: 5000,
};

describe('URL capture request characterization', () => {
  it.each([
    null, undefined, false, 0, '', {},
    ...[undefined, null, 1, 'x'.repeat(2049)].map(url => ({ ...request, url })),
    ...[undefined, null, false, {}].map(viewport => ({ ...request, viewport })),
    ...['width', 'height'].flatMap(key => [undefined, null, '1', NaN, Infinity, 0, 1.5, key === 'width' ? 1281 : 1025]
      .map(value => ({ ...request, viewport: { ...request.viewport, [key]: value } }))),
    ...[null, 0, 3, '1'].map(deviceScaleFactor => ({ ...request, viewport: { ...request.viewport, deviceScaleFactor } })),
    ...[null, 0, 'false'].map(isMobile => ({ ...request, viewport: { ...request.viewport, isMobile } })),
    ...[undefined, null, 0, 'true'].map(fullPage => ({ ...request, fullPage })),
    ...[undefined, null, '1', NaN, Infinity, 0, 1.5, 8001].map(maxPageHeightPx => ({ ...request, maxPageHeightPx })),
    ...[undefined, null, '0', NaN, Infinity, -1, 0.5, 5001].map(settleMs => ({ ...request, settleMs })),
  ])('rejects invalid wire value %#', value => {
    expect(() => readUrlCaptureRequest({ value })).toThrow('invalid capture request');
  });

  it.each([
    request,
    { ...request, url: 'x'.repeat(2048), viewport: { width: 1, height: 1 }, fullPage: true, maxPageHeightPx: 1, settleMs: 0 },
    ...[1, 2].flatMap(deviceScaleFactor => [true, false].map(isMobile => ({
      ...request, viewport: { ...request.viewport, deviceScaleFactor, isMobile },
    }))),
  ])('accepts inclusive bounds and viewport variants %#', value => {
    const parsed = readUrlCaptureRequest({ value });
    expect(parsed).toEqual(value);
    expect(parsed).not.toBe(value);
    expect(parsed.viewport).not.toBe(value.viewport);
  });

  it('leaves URL policy to the renderer and preserves extra viewport fields', () => {
    const value = { ...request, url: 'file:///private', extra: true, viewport: { ...request.viewport, extra: 'kept' } };
    expect(readUrlCaptureRequest({ value })).toEqual({ ...request, url: value.url, viewport: value.viewport });
  });
});
