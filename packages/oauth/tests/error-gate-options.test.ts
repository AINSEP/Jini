import { expect, it } from 'vitest';
import { assertOAuthAppOptions } from '../src/options.js';
import { OAuthError } from '../src/errors.js';

it('refuses malformed and fragmented callbacks with the existing option error', () => {
  for (const uri of ['http://[invalid', 'http://localhost/callback#secret-marker']) {
    const options = { clientDisplayName: 'Test', softwareId: 'test', redirectUris: [uri] };
    expect(() => assertOAuthAppOptions(options)).toThrow(OAuthError);
    expect(() => assertOAuthAppOptions(options)).toThrow("OAuth client option 'redirectUris' is required and must be valid");
  }
  expect(() => assertOAuthAppOptions({ clientDisplayName: 'Test', softwareId: 'test', redirectUris: ['http://localhost/callback'] })).not.toThrow();
});
