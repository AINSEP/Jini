import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isPrivateAddress } from '@jini-ai/platform/net';
import { createOAuthUrlGuard, assertSafeUserFacingUrl } from '../../../src/endpoint-safety.js';
import { OAuthError } from '../../../src/errors.js';

const seed = Number(process.env.FC_SEED ?? 20261020);
const options = { seed, numRuns: 150 };
const path = fc.string({ maxLength: 40 }).map(encodeURIComponent);
const octet = fc.integer({ min: 0, max: 255 });
const label = 'token endpoint';

beforeAll(() => console.info(`[fast-check oauth/endpoint-safety] seed=${seed}, numRuns=${options.numRuns}`));

describe('OAuth endpoint safety properties', () => {
  it('refuses non-HTTPS schemes before consulting the application policy', () => {
    fc.assert(fc.property(fc.constantFrom('http', 'ftp', 'file', 'ws', 'javascript', 'data'), path, (scheme, suffix) => {
      let policyCalls = 0;
      const guard = createOAuthUrlGuard({ assertAllowed: () => { policyCalls++; } });
      expect(() => guard.assertSafeUrl({ raw: `${scheme}://auth.example.com/${suffix}`, label })).toThrowError(OAuthError);
      expect(policyCalls).toBe(0);
    }), options);
  });

  it('normalizes HTTPS endpoints and passes an independent URL snapshot to policy', () => {
    fc.assert(fc.property(path, fc.integer({ min: 1024, max: 65535 }), (suffix, port) => {
      const raw = `  https://AUTH.example.com:${port}/${suffix}?q=1  `;
      const expected = new URL(raw.trim());
      const seen: string[] = [];
      const guard = createOAuthUrlGuard({ assertAllowed: ({ url, label: subject }) => {
        seen.push(url.href, subject);
        url.hostname = 'mutated.example.com';
        url.protocol = 'http:';
      } });
      expect(guard.assertSafeUrl({ raw, label }).href).toBe(expected.href);
      expect(seen).toEqual([expected.href, label]);
    }), options);
  });

  it('the development plaintext exception still requires application approval', () => {
    fc.assert(fc.property(octet, octet, octet, path, (a, b, c, suffix) => {
      const ipv4 = `127.${a}.${b}.${c}`;
      for (const host of [ipv4, 'localhost', '[::1]', `[::ffff:${ipv4}]`]) {
        const raw = `http://${host}:8080/${suffix}`;
        let approved = 0;
        const allow = createOAuthUrlGuard({ assertAllowed: () => { approved++; } }, { allowLoopbackHttp: true });
        expect(allow.assertSafeUrl({ raw, label }).href).toBe(new URL(raw).href);
        expect(approved).toBe(1);
        const denial = new Error('policy denied');
        const deny = createOAuthUrlGuard({ assertAllowed: () => { throw denial; } }, { allowLoopbackHttp: true });
        expect(() => deny.assertSafeUrl({ raw, label })).toThrowError(OAuthError);
      }
    }), options);
  });

  it('a strict platform-backed policy refuses internal HTTPS literals and embedded forms', () => {
    const guard = createOAuthUrlGuard({ assertAllowed: ({ url }) => {
      // OAuth owns scheme/error handling; the platform owns peer address classification.
      if (isPrivateAddress({ address: url.hostname.replace(/^\[|\]$/g, '') })) throw new Error('non-public peer');
    } });
    fc.assert(fc.property(octet, octet, (a, b) => {
      for (const ip of [`10.${a}.${b}.1`, `127.${a}.${b}.1`, `169.254.${a}.${b}`, `192.168.${a}.${b}`]) {
        for (const host of [ip, `[::ffff:${ip}]`, `[::ffff:0:${ip}]`, `[64:ff9b::${ip}]`]) {
          expect(() => guard.assertSafeUrl({ raw: `https://${host}/token`, label })).toThrowError(OAuthError);
        }
      }
      expect(guard.assertSafeUrl({ raw: 'https://8.8.8.8/token', label }).href).toBe('https://8.8.8.8/token');
    }), options);
  });

  it('user-facing links never accept embedded credentials', () => {
    const guard = createOAuthUrlGuard({ assertAllowed: () => {} });
    const credential = fc.string({ minLength: 1, maxLength: 30 }).map(value => 'u' + encodeURIComponent(value));
    fc.assert(fc.property(credential, path, (username, suffix) => {
      expect(() => assertSafeUserFacingUrl({ raw: `https://${username}:password@auth.example.com/${suffix}`, guard }))
        .toThrowError(OAuthError);
    }), options);
  });
});
