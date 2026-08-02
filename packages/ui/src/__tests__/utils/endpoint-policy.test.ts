import { describe, expect, it } from 'vitest';

import {
  isAllowedEndpointUrl,
  isBlockedEndpointHost,
  isLoopbackEndpointHost,
} from '../../utils/endpoint-policy.js';
import { isValidApiBaseUrl } from '../../features/execution/rules.js';
import { isProviderBaseUrlInvalid } from '../../features/media-providers/rules.js';
import { validateSourceDraft } from '../../features/source-config-list/rules.js';

/**
 * @file The shared endpoint policy, and proof that all three tabs that take an
 * operator-supplied endpoint now enforce it.
 *
 * Before this existed the execution tab checked the scheme and nothing else,
 * the media-providers tab checked nothing at all, and a `url`-kind source field
 * checked the scheme. Each of those fields is persisted and paired with an API
 * key that gets sent to whatever it names, so `http://169.254.169.254/` was an
 * accepted destination for a credentialed request on every one of them.
 */

/** Endpoints no tab may accept, each with the reason it is dangerous rather than merely odd. */
const BLOCKED = [
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata service'],
  ['http://169.254.169.254./', 'metadata service, RFC 1034 trailing dot'],
  ['http://10.0.0.5/v1', 'RFC1918 10/8'],
  ['http://192.168.1.1/v1', 'RFC1918 192.168/16'],
  ['http://172.16.0.1/v1', 'RFC1918 172.16/12'],
  ['http://100.64.0.1/v1', 'CGNAT'],
  ['http://0.0.0.0/v1', 'unspecified'],
  ['http://[::]/v1', 'IPv6 unspecified'],
  ['http://[fd00::1]/v1', 'IPv6 unique-local'],
  ['http://[fe80::1]/v1', 'IPv6 link-local'],
  ['http://[::ffff:10.0.0.5]/v1', 'IPv4-mapped IPv6 RFC1918'],
  ['http://[::ffff:a00:5]/v1', 'IPv4-mapped IPv6 RFC1918, hex form'],
  ['http://224.0.0.1/v1', 'multicast'],
] as const;

/** Endpoints that must keep working — loopback is a first-class config (local model servers). */
const ALLOWED = [
  'https://api.openai.com/v1',
  'https://example.com',
  'http://localhost:11434/v1',
  'http://localhost./v1',
  'http://127.0.0.1:11434/v1',
  'http://[::1]:11434/v1',
  'http://[::ffff:127.0.0.1]/v1',
] as const;

describe('isAllowedEndpointUrl', () => {
  it.each(BLOCKED)('rejects %s (%s)', (url) => {
    expect(isAllowedEndpointUrl(url)).toBe(false);
  });

  it.each(ALLOWED)('accepts %s', (url) => {
    expect(isAllowedEndpointUrl(url)).toBe(true);
  });

  it('still rejects what the old scheme-only check rejected', () => {
    expect(isAllowedEndpointUrl('')).toBe(false);
    expect(isAllowedEndpointUrl('   ')).toBe(false);
    expect(isAllowedEndpointUrl('not-a-url')).toBe(false);
    expect(isAllowedEndpointUrl('ftp://example.com/file')).toBe(false);
    expect(isAllowedEndpointUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedEndpointUrl('/relative/path')).toBe(false);
  });

  it('trims, matching how every call site treats operator input', () => {
    expect(isAllowedEndpointUrl('  https://example.com  ')).toBe(true);
  });

  it('does NOT claim to catch a public name resolving to private space — that needs DNS', () => {
    // Documented boundary, not an oversight: `connection-guard.ts`'s
    // `validateBaseUrlResolved` covers this at connection time. If this ever
    // starts returning false, the two layers have diverged.
    expect(isAllowedEndpointUrl('https://internal.example.com/v1')).toBe(true);
  });
});

describe('host predicates', () => {
  it('treats loopback as loopback, not as blocked private space', () => {
    expect(isLoopbackEndpointHost('127.0.0.1')).toBe(true);
    expect(isLoopbackEndpointHost('127.9.9.9')).toBe(true);
    expect(isLoopbackEndpointHost('localhost')).toBe(true);
    expect(isLoopbackEndpointHost('LOCALHOST.')).toBe(true);
    expect(isLoopbackEndpointHost('::1')).toBe(true);
    expect(isLoopbackEndpointHost('example.com')).toBe(false);
  });

  it('flags private address space', () => {
    expect(isBlockedEndpointHost('169.254.169.254')).toBe(true);
    expect(isBlockedEndpointHost('10.1.2.3')).toBe(true);
    expect(isBlockedEndpointHost('172.15.0.1')).toBe(false); // just below the /12
    expect(isBlockedEndpointHost('172.32.0.1')).toBe(false); // just above the /12
    expect(isBlockedEndpointHost('example.com')).toBe(false);
  });
});

describe('every endpoint-taking tab enforces the same policy', () => {
  const METADATA = 'http://169.254.169.254/latest/meta-data/';

  it('execution tab: isValidApiBaseUrl rejects the metadata service', () => {
    expect(isValidApiBaseUrl(METADATA)).toBe(false);
    expect(isValidApiBaseUrl('https://api.anthropic.com')).toBe(true);
    expect(isValidApiBaseUrl('http://localhost:11434/v1')).toBe(true);
  });

  it('media-providers tab: a typed metadata-service base URL is invalid', () => {
    expect(isProviderBaseUrlInvalid({ baseUrl: METADATA })).toBe(true);
    expect(isProviderBaseUrlInvalid({ baseUrl: 'https://api.example.com' })).toBe(false);
    // Blank is not an error state — the catalog default takes over.
    expect(isProviderBaseUrlInvalid({ baseUrl: '' })).toBe(false);
    expect(isProviderBaseUrlInvalid({ baseUrl: '   ' })).toBe(false);
    expect(isProviderBaseUrlInvalid({})).toBe(false);
    expect(isProviderBaseUrlInvalid(null)).toBe(false);
  });

  it('source-config-list: a url-kind field rejects the metadata service', () => {
    const spec = [{ key: 'url', label: 'URL', kind: 'url', required: true }] as const;
    expect(validateSourceDraft(spec, { url: METADATA }).ok).toBe(false);
    expect(validateSourceDraft(spec, { url: 'https://example.com/mcp' }).ok).toBe(true);
  });
});
