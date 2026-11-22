import { describe, expect, it } from 'vitest';
import { isOwnLinkHref } from '../own-link.js';

/**
 * @file Which links count as "the owner's own site or admin" for the chat's link rule (owner
 * decision 2026-11-21, reversing 2026-10-08): the link text stays in this tab, a small icon opens a
 * new one. Everything else keeps opening a new tab.
 */
const origin = 'https://admin.example.test';

describe('isOwnLinkHref', () => {
  it('treats an in-app path as own', () => {
    expect(isOwnLinkHref({ href: '/admin/pages/x', origin })).toBe(true);
  });

  it('treats an absolute URL on the same origin as own', () => {
    expect(isOwnLinkHref({ href: 'https://admin.example.test/blog/hello', origin })).toBe(true);
  });

  it('treats another website, another port and another scheme as not own', () => {
    expect(isOwnLinkHref({ href: 'https://example.com/docs', origin })).toBe(false);
    expect(isOwnLinkHref({ href: 'https://admin.example.test:8443/x', origin })).toBe(false);
    expect(isOwnLinkHref({ href: 'http://admin.example.test/x', origin })).toBe(false);
  });

  it('treats a look-alike host that merely starts with the origin as not own', () => {
    expect(isOwnLinkHref({ href: 'https://admin.example.test.evil.example/x', origin })).toBe(false);
  });

  it('treats mailto, a protocol-relative URL and an unparseable value as not own', () => {
    expect(isOwnLinkHref({ href: 'mailto:a@example.com', origin })).toBe(false);
    expect(isOwnLinkHref({ href: '//evil.example/x', origin })).toBe(false);
    expect(isOwnLinkHref({ href: 'http://', origin })).toBe(false);
  });

  it('treats a same-document anchor as not own so it keeps its in-place jump with no icon', () => {
    expect(isOwnLinkHref({ href: '#details', origin })).toBe(false);
  });
});
