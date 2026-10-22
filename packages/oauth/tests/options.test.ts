/**
 * Direct tests for `assertOAuthAppOptions`, the fail-before-effects guard on an application's own
 * OAuth identity. The flow tests only ever pass a valid identity or a fragment-bearing URI; the
 * unparseable/non-string redirect URI and missing-array cases were never exercised.
 */
import { describe, expect, it } from 'vitest';
import { OAuthError } from '../src/errors.js';
import { assertOAuthAppOptions } from '../src/options.js';
import type { OAuthAppOptions } from '../src/ports.js';

const valid: OAuthAppOptions = { clientDisplayName: 'Example Client', softwareId: 'example.client', redirectUris: ['https://app.example.com/callback', 'http://127.0.0.1:8123/cb'] };

function rejection(options: unknown): OAuthError {
  let caught: unknown;
  try { assertOAuthAppOptions(options as OAuthAppOptions); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(OAuthError);
  return caught as OAuthError;
}

describe('assertOAuthAppOptions', () => {
  it('accepts a complete identity, including an empty redirect list', () => {
    expect(() => assertOAuthAppOptions(valid)).not.toThrow();
    expect(() => assertOAuthAppOptions({ ...valid, redirectUris: [] })).not.toThrow();
  });

  it('names the missing or blank identity field with an operator action', () => {
    for (const [patch, key] of [
      [{ clientDisplayName: undefined }, 'clientDisplayName'], [{ clientDisplayName: '   ' }, 'clientDisplayName'],
      [{ softwareId: 7 }, 'softwareId'], [{ softwareId: '' }, 'softwareId'],
    ] as const) {
      const error = rejection({ ...valid, ...patch });
      expect(error.code).toBe('OAUTH_INVALID_REQUEST');
      expect(error.message).toBe(`OAuth client option '${key}' is required and must be valid`);
      expect(error.operatorAction).toBe('Supply the application identity and registered callback URLs explicitly.');
      expect(error.retryable).toBe(false);
    }
  });

  it('rejects absent options with the first identity field rather than a TypeError', () => {
    expect(rejection(undefined).message).toBe("OAuth client option 'clientDisplayName' is required and must be valid");
  });

  it('rejects a redirect list that is not an array', () => {
    expect(rejection({ ...valid, redirectUris: 'https://app.example.com/callback' }).message).toBe("OAuth client option 'redirectUris' is required and must be valid");
  });

  it('rejects a non-string, unparseable, relative or fragment-bearing redirect URI', () => {
    for (const uri of [42, null, 'not a url', '/callback', 'https://app.example.com/cb#frag']) {
      expect(rejection({ ...valid, redirectUris: ['https://app.example.com/ok', uri] }).message).toBe("OAuth client option 'redirectUris' is required and must be valid");
    }
  });
});
