import { describe, expect, it } from 'vitest';
import { createOAuthUrlGuard, assertSafeProviderEndpoint, assertSafeUserFacingUrl } from '../../src/endpoint-safety.js';
import { OAuthError } from '../../src/errors.js';

describe('OAuth URL guard characterization', () => {
  it.each(['localhost', 'LOCALHOST.', '127.0.0.1', '127.255.255.255', '127.1', '[::1]', '[::ffff:127.0.0.2]'])
    ('allows plaintext loopback only by explicit opt in and still runs host policy: %s', host => {
      const raw = `http://${host}/token`;
      const calls: { href: string; label: string }[] = [];
      const guard = createOAuthUrlGuard({ assertAllowed: ({ url, label }) => { calls.push({ href: url.href, label }); } }, { allowLoopbackHttp: true });
      expect(guard.assertSafeUrl({ raw, label: 'token endpoint' }).href).toBe(new URL(raw).href);
      expect(calls).toEqual([{ href: new URL(raw).href, label: 'token endpoint' }]);
      expect(() => createOAuthUrlGuard({ assertAllowed: () => undefined }).assertSafeUrl({ raw, label: 'token endpoint' }))
        .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'token endpoint: provider endpoint must use https (http is permitted only for loopback)' }));
    });

  it.each(['http://128.0.0.1/token', 'http://localhost.evil.example/token', 'http://[::ffff:128.0.0.1]/token', 'ftp://localhost/token'])
    ('rejects unsafe schemes and non-loopback HTTP before host policy: %s', raw => {
      const calls: string[] = [];
      const guard = createOAuthUrlGuard({ assertAllowed: ({ url }) => { calls.push(url.href); } }, { allowLoopbackHttp: true });
      expect(() => guard.assertSafeUrl({ raw, label: 'registration endpoint' })).toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT' }));
      expect(calls).toEqual([]);
    });

  it.each(['not a url', '/relative'])('uses a distinct message for malformed displayed links: %s', raw => {
    const guard = createOAuthUrlGuard({ assertAllowed: () => { throw new Error('policy must not run'); } });
    expect(() => guard.assertSafeUrl({ raw, label: 'provider-supplied link' }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'provider-supplied link is not a valid absolute URL' }));
    expect(() => guard.assertSafeUrl({ raw, label: 'token endpoint' }))
      .toThrow(expect.objectContaining({ message: 'token endpoint: provider endpoint is not a valid absolute URL' }));
  });

  it('trims input and passes policy a detached URL snapshot', () => {
    const calls: string[] = [];
    const guard = createOAuthUrlGuard({ assertAllowed: ({ url, label }) => {
      calls.push(`${label} ${url.href}`); url.hostname = 'changed.example';
    } });
    expect(assertSafeProviderEndpoint(' https://AUTH.example:443/token ', 'token endpoint', guard).href).toBe('https://auth.example/token');
    expect(calls).toEqual(['token endpoint https://auth.example/token']);
  });

  it('preserves an OAuth policy error by identity and wraps other failures with their cause', () => {
    const typed = new OAuthError({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'Denied', operatorAction: 'Check policy' });
    const guard = createOAuthUrlGuard({ assertAllowed: () => { throw typed; } });
    expect(() => guard.assertSafeUrl({ raw: 'https://auth.example/token', label: 'token endpoint' })).toThrow(typed);
    let thrown: unknown;
    try { guard.assertSafeUrl({ raw: 'https://auth.example/token', label: 'token endpoint' }); }
    catch (error) { thrown = error; }
    expect(thrown).toBe(typed);
    const cause = new Error('denied');
    const wrapping = createOAuthUrlGuard({ assertAllowed: () => { throw cause; } });
    expect(() => wrapping.assertSafeUrl({ raw: 'https://auth.example/link', label: 'provider-supplied link' }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'provider-supplied link was rejected by the outbound URL policy', cause,
        operatorAction: 'Check the application outbound URL policy for this provider.' }));
  });

  it('still permits endpoint userinfo but refuses to display it (reported, not fixed)', () => {
    const guard = createOAuthUrlGuard({ assertAllowed: () => undefined });
    for (const raw of ['https://user@auth.example/token', 'https://:secret@auth.example/token']) {
      expect(guard.assertSafeUrl({ raw, label: 'token endpoint' }).href).toBe(raw);
      expect(() => assertSafeUserFacingUrl({ raw, guard }))
        .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'provider-supplied link embeds credentials in the URL' }));
    }
    expect(assertSafeUserFacingUrl({ raw: 'https://auth.example/activate', guard }).href).toBe('https://auth.example/activate');
  });
});
