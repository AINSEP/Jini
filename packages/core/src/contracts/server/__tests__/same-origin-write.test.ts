import { expect, test } from 'vitest';

import { isSameOriginBrowserWrite } from '../same-origin-write.js';

const HOST = 'page.acme.test:8443';
const allowed = (origin: string | undefined, fetchSite?: string) => isSameOriginBrowserWrite({ origin, host: HOST, fetchSite });

test('the exact https or http origin of this host is admitted, with or without fetch metadata', () => {
  expect(allowed('https://page.acme.test:8443')).toBe(true);
  expect(allowed('http://page.acme.test:8443', 'same-origin')).toBe(true);
});

test('security: a missing Origin or a missing Host is refused', () => {
  expect(allowed(undefined)).toBe(false);
  expect(allowed('')).toBe(false);
  expect(isSameOriginBrowserWrite({ origin: 'https://page.acme.test:8443', host: undefined, fetchSite: undefined })).toBe(false);
});

test('security: fetch metadata other than same-origin is refused even with a matching Origin', () => {
  for (const site of ['same-site', 'cross-site', 'none']) expect(allowed('https://page.acme.test:8443', site), site).toBe(false);
});

test('security: a sandboxed frame\'s opaque "null" origin is refused', () => {
  expect(allowed('null')).toBe(false);
});

test('security: another host or port is refused', () => {
  expect(allowed('https://evil.acme.test:8443')).toBe(false);
  expect(allowed('https://page.acme.test')).toBe(false);
});

test('security: an Origin that is not a bare origin (path, trailing slash, credentials) is refused', () => {
  for (const origin of ['https://page.acme.test:8443/', 'https://page.acme.test:8443/write', 'https://user@page.acme.test:8443']) expect(allowed(origin), origin).toBe(false);
});

test('security: a non-http(s) scheme naming this host is refused', () => {
  expect(allowed('ftp://page.acme.test:8443')).toBe(false);
  expect(allowed('ws://page.acme.test:8443')).toBe(false);
});

test('security: an Origin with an uppercase host is not canonical', () => {
  expect(allowed('https://PAGE.acme.test:8443')).toBe(false);
});

test('host-only matching accepts both HTTP and HTTPS independently of scheme', () => {
  expect(allowed('http://page.acme.test:8443')).toBe(true);
  expect(allowed('https://page.acme.test:8443', 'same-origin')).toBe(true);
});
