import { describe, expect, it } from 'vitest';
import { resolveProviderCredentialsFromEnv } from '../credentials.js';

describe('resolveProviderCredentialsFromEnv', () => {
  it('returns {} for an unknown provider', () => {
    expect(resolveProviderCredentialsFromEnv('not-a-real-provider')).toEqual({});
  });

  it('returns {} when none of the candidate env vars are set', () => {
    expect(resolveProviderCredentialsFromEnv('openai', {})).toEqual({});
  });

  it('resolves apiKey from the first set candidate env var', () => {
    expect(resolveProviderCredentialsFromEnv('openai', { OPENAI_API_KEY: 'sk-abc' })).toEqual({ apiKey: 'sk-abc' });
  });

  it('honors priority order across multiple candidates', () => {
    expect(resolveProviderCredentialsFromEnv('volcengine', { VOLCENGINE_API_KEY: 'second', ARK_API_KEY: 'first' })).toEqual({ apiKey: 'first' });
    expect(resolveProviderCredentialsFromEnv('volcengine', { VOLCENGINE_API_KEY: 'second' })).toEqual({ apiKey: 'second' });
  });

  it('trims whitespace and treats a blank value as unset', () => {
    expect(resolveProviderCredentialsFromEnv('openai', { OPENAI_API_KEY: '  sk-abc  ' })).toEqual({ apiKey: 'sk-abc' });
    expect(resolveProviderCredentialsFromEnv('openai', { OPENAI_API_KEY: '   ' })).toEqual({});
  });
});
