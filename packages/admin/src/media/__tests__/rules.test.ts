import { describe, it, expect } from 'vitest';
import { createMemoryMediaApi } from '../adapters/memory.js';
import {
  acceptsMedia, canRestoreMedia, filterMediaByTab, isRetryableMediaError, queryMedia, resolveActiveTab, safeMediaUrl,
} from '../rules.js';
it('keeps untyped and opaque assets on All and resolves unknown tabs safely', async () => {
  const api = createMemoryMediaApi({});
  const image = await api.upload({
    filename: 'a.svg',
    contentType: 'image/svg+xml',
    dataBase64: '',
  });
  const unknown = { ...image, id: 'unknown', contentType: null };
  expect(filterMediaByTab({ media: [image, unknown], tab: 'images' })).toEqual([image]);
  expect(filterMediaByTab({ media: [image, unknown], tab: 'all' })).toHaveLength(2);
  expect(resolveActiveTab({ tabId: 'typo' })).toBe('all');
  expect(resolveActiveTab({ tabId: 'external-providers' })).toBe('external-providers');
  expect(acceptsMedia({ item: image, accept: ['image/*'] })).toBe(true);
  expect(acceptsMedia({ item: unknown, accept: ['image/*'] })).toBe(false);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    '//evil.test',
    '/\\evil.test',
    'memory://opaque',
  ])
    expect(safeMediaUrl({ url })).toBeUndefined();
  expect(safeMediaUrl({ url: '/api/original' })).toBe('/api/original');
});

describe('canRestoreMedia', () => {
  it('is true when the port has a restore method and does not disable it', () => {
    expect(canRestoreMedia({ api: createMemoryMediaApi({}) })).toBe(true);
  });
  it('is false when the port has no restore method', () => {
    const { restore, ...api } = createMemoryMediaApi({});
    expect(canRestoreMedia({ api })).toBe(false);
  });
  it('is false when the legacy restoreSupported flag explicitly disables restore', () => {
    expect(canRestoreMedia({ api: { ...createMemoryMediaApi({}), restoreSupported: false } })).toBe(false);
  });
});

describe('isRetryableMediaError', () => {
  it.each([null, undefined, 'HTTP 503', 503, true])('is false for the non-object error %j', (error) => {
    expect(isRetryableMediaError({ error })).toBe(false);
  });
  it.each([
    [{ retryable: true, status: 400 }, true],
    [{ retryable: false, status: 503 }, false],
    [Object.assign(new TypeError('fetch failed'), { retryable: false }), false],
  ])('trusts a boolean transport retryable flag over every other signal: %j', (error, expected) => {
    expect(isRetryableMediaError({ error })).toBe(expected);
  });
  it.each([408, 429, 500, 503, 599])('retries the temporary HTTP status %s', (status) => {
    expect(isRetryableMediaError({ error: { status } })).toBe(true);
  });
  it.each([0, 400, 401, 403, 404, 409, 422, 499, 600])('does not retry the HTTP status %s', (status) => {
    // Authorization/validation failures must never produce an automatic request loop.
    expect(isRetryableMediaError({ error: { status } })).toBe(false);
  });
  it('ignores a non-boolean retryable flag and falls back to the status', () => {
    expect(isRetryableMediaError({ error: { retryable: 'yes', status: 404 } })).toBe(false);
  });
  it('reads statusCode when status is absent', () => {
    expect(isRetryableMediaError({ error: { statusCode: 503 } })).toBe(true);
  });
  it('prefers status over statusCode and over the message', () => {
    expect(isRetryableMediaError({ error: { status: 400, statusCode: 503, message: 'HTTP 503' } })).toBe(false);
  });
  it('prefers statusCode over the message', () => {
    expect(isRetryableMediaError({ error: { statusCode: 404, message: 'HTTP 503' } })).toBe(false);
  });
  it.each([
    ['HTTP 503 Service Unavailable', true],
    ['request failed: http 429', true],
    ['HTTP  408', true],
    ['HTTP 404 Not Found', false],
    ['Server error 503', false],
    ['', false],
  ])('parses a legacy status out of the message %j', (message, expected) => {
    expect(isRetryableMediaError({ error: new Error(message) })).toBe(expected);
  });
  it('reads only the first three digits of a longer number, so "HTTP 5000" retries as 500 (reported, not fixed)', () => {
    // The message pattern has no trailing boundary after the three status digits.
    expect(isRetryableMediaError({ error: new Error('HTTP 5000') })).toBe(true);
  });
  it('retries a network TypeError that carries no status', () => {
    expect(isRetryableMediaError({ error: new TypeError('Failed to fetch') })).toBe(true);
  });
  it('retries a TypeError even when it carries a non-retryable status', () => {
    expect(isRetryableMediaError({ error: Object.assign(new TypeError('x'), { status: 404 }) })).toBe(true);
  });
  it('does not retry a plain object or Error with no status signal', () => {
    expect(isRetryableMediaError({ error: {} })).toBe(false);
    expect(isRetryableMediaError({ error: new Error('boom') })).toBe(false);
  });
});

describe('queryMedia status filter', () => {
  it('keeps only assets whose status matches the requested status', async () => {
    const active = await createMemoryMediaApi({}).upload({ filename: 'a.png', contentType: 'image/png', dataBase64: '' });
    const trashed = { ...active, id: 'trashed', status: 'trashed' as const };
    expect(queryMedia({ media: [active, trashed], query: { status: 'trashed' } })).toEqual([trashed]);
    expect(queryMedia({ media: [active, trashed], query: { status: 'active' } })).toEqual([active]);
  });
});

describe('acceptsMedia', () => {
  const png = { contentType: 'image/png' };
  it.each([[[]], [['*/*']], [['video/*', '*/*']]])('accepts any type, including none, for the accept list %j', (accept) => {
    expect(acceptsMedia({ item: png, accept })).toBe(true);
    expect(acceptsMedia({ item: { contentType: null }, accept })).toBe(true);
  });
  it('accepts an exact MIME match and rejects a different exact type', () => {
    expect(acceptsMedia({ item: png, accept: ['image/png'] })).toBe(true);
    expect(acceptsMedia({ item: png, accept: ['image/jpeg'] })).toBe(false);
  });
  it('rejects an untyped asset against a non-wildcard accept list', () => {
    expect(acceptsMedia({ item: { contentType: null }, accept: ['image/png'] })).toBe(false);
  });
});

describe('safeMediaUrl allowed schemes', () => {
  it.each(['https://cdn.test/a.png', 'http://cdn.test/a.png', 'blob:https://app.test/0f1e'])('keeps the %s URL unchanged', (url) => {
    expect(safeMediaUrl({ url })).toBe(url);
  });
  it.each(['ftp://cdn.test/a.png', 'not a url'])('fails closed on %s', (url) => {
    expect(safeMediaUrl({ url })).toBeUndefined();
  });
});
