import { describe, expect, it } from 'vitest';

import {
  apiTokenFromEnv,
  isApiAuthDisabled,
  isApiTokenMiddlewareEnabled,
  isTruthyEnvFlag,
  type ApiTokenAuthEnvConfig,
} from '../api-token-auth.js';

const CONFIG: ApiTokenAuthEnvConfig = {
  tokenEnvVar: 'FAKE_API_TOKEN',
  disableEnvVar: 'FAKE_DISABLE_API_AUTH',
};

describe('@jini-ai/core — api-token-auth — isTruthyEnvFlag', () => {
  it('recognizes truthy spellings case-insensitively and trims whitespace', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'On']) {
      expect(isTruthyEnvFlag(value)).toBe(true);
    }
  });

  it('treats everything else, including undefined, as falsy', () => {
    for (const value of ['0', 'false', 'no', 'off', '', 'maybe', undefined, null]) {
      expect(isTruthyEnvFlag(value)).toBe(false);
    }
  });
});

describe('@jini-ai/core — api-token-auth — isApiAuthDisabled', () => {
  it('is false by default and true when the disable flag is set', () => {
    expect(isApiAuthDisabled(CONFIG, {})).toBe(false);
    expect(isApiAuthDisabled(CONFIG, { [CONFIG.disableEnvVar]: '1' })).toBe(true);
  });
});

describe('@jini-ai/core — api-token-auth — apiTokenFromEnv', () => {
  it('returns the trimmed token, or empty string when unset', () => {
    expect(apiTokenFromEnv(CONFIG, {})).toBe('');
    expect(apiTokenFromEnv(CONFIG, { [CONFIG.tokenEnvVar]: '  secret-token  ' })).toBe('secret-token');
  });
});

describe('@jini-ai/core — api-token-auth — isApiTokenMiddlewareEnabled', () => {
  it('is disabled when no token is configured', () => {
    expect(isApiTokenMiddlewareEnabled(CONFIG, {})).toBe(false);
  });

  it('is enabled once a token is configured', () => {
    expect(isApiTokenMiddlewareEnabled(CONFIG, { [CONFIG.tokenEnvVar]: 'secret' })).toBe(true);
  });

  it('stays disabled when a token is configured but the disable flag is set', () => {
    expect(
      isApiTokenMiddlewareEnabled(CONFIG, { [CONFIG.tokenEnvVar]: 'secret', [CONFIG.disableEnvVar]: 'true' }),
    ).toBe(false);
  });
});
