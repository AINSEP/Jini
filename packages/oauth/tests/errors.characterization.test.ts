/**
 * @file Characterization pin for `errors.ts` before the loopback receiver adds two codes:
 * the retryable set must stay exactly the two device-polling codes, and `mapProviderErrorCode`
 * must keep its current mapping, so a new terminal code can never make an existing one retry.
 */
import { expect, test } from 'vitest';
import { OAuthError, mapProviderErrorCode, type OAuthErrorCode } from '../src/index.js';

const EXISTING_CODES: readonly OAuthErrorCode[] = [
  'OAUTH_PROVIDER_UNREACHABLE', 'OAUTH_PROVIDER_REJECTED', 'OAUTH_INVALID_STATE', 'OAUTH_INVALID_GRANT',
  'OAUTH_AUTHORIZATION_PENDING', 'OAUTH_SLOW_DOWN', 'OAUTH_ACCESS_DENIED', 'OAUTH_EXPIRED_TOKEN',
  'OAUTH_UNSUPPORTED_GRANT', 'OAUTH_MALFORMED_RESPONSE', 'OAUTH_UNSAFE_ENDPOINT', 'OAUTH_INVALID_REQUEST',
];

test('only the two device-polling codes are retryable among the existing codes', () => {
  const retryable = EXISTING_CODES.filter(code => new OAuthError({ code, message: 'm', operatorAction: 'a' }).retryable);
  expect(retryable).toEqual(['OAUTH_AUTHORIZATION_PENDING', 'OAUTH_SLOW_DOWN']);
});

test('provider error codes keep their current mapping, unknown ones fall to provider-rejected', () => {
  const mapped = ['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'invalid_grant', 'unsupported_grant_type', 'other']
    .map(providerErrorCode => mapProviderErrorCode({ providerErrorCode }));
  expect(mapped).toEqual([
    'OAUTH_AUTHORIZATION_PENDING', 'OAUTH_SLOW_DOWN', 'OAUTH_ACCESS_DENIED', 'OAUTH_EXPIRED_TOKEN',
    'OAUTH_INVALID_GRANT', 'OAUTH_UNSUPPORTED_GRANT', 'OAUTH_PROVIDER_REJECTED',
  ]);
});
