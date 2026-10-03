import { describe, expect, it } from 'vitest';
import { resolveProviderCredentialsFromEnv } from '../credentials.js';

describe('resolveProviderCredentialsFromEnv', () => {
    it('returns {} for an unknown provider', () => {
        expect(resolveProviderCredentialsFromEnv({ providerId: 'not-a-real-provider', env: {} })).toEqual({});
    });
    it('returns {} when none of the candidate env vars are set', () => {
        expect(resolveProviderCredentialsFromEnv({ providerId: 'openai', env: {} })).toEqual({});
    });
    it('resolves apiKey from the first set candidate env var', () => {
        expect(resolveProviderCredentialsFromEnv({ providerId: 'openai', env: { OPENAI_API_KEY: 'sk-abc' } })).toEqual({ apiKey: 'sk-abc' });
    });
    it('honors priority order across multiple candidates', () => {
        expect(resolveProviderCredentialsFromEnv({ providerId: 'volcengine', env: { VOLCENGINE_API_KEY: 'second', ARK_API_KEY: 'first' } })).toEqual({ apiKey: 'first' });
        expect(resolveProviderCredentialsFromEnv({ providerId: 'volcengine', env: { VOLCENGINE_API_KEY: 'second' } })).toEqual({ apiKey: 'second' });
    });
    it('trims whitespace and treats a blank value as unset', () => {
        expect(resolveProviderCredentialsFromEnv({ providerId: 'openai', env: { OPENAI_API_KEY: '  sk-abc  ' } })).toEqual({ apiKey: 'sk-abc' });
        expect(resolveProviderCredentialsFromEnv({ providerId: 'openai', env: { OPENAI_API_KEY: '   ' } })).toEqual({});
    });
});
