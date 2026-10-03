import { describe, expect, it } from 'vitest';
import {
  effectiveAgentModelChoice,
  fingerprintCredential,
  mergeModelOptions,
  modelCatalogCacheKey,
  normalizeAgentModelChoice,
  resolveCredentialStatus,
} from './model-registry.js';

describe('resolveCredentialStatus', () => {
  it('returns "available" when the provider does not require credentials', () => {
    expect(resolveCredentialStatus({ provider: { credentialsRequired: false }, hasStoredCredential: false })).toBe('available');
    expect(resolveCredentialStatus({ provider: { credentialsRequired: false }, hasStoredCredential: true })).toBe('available');
  });

  it('returns "configured" when a credential is stored', () => {
    expect(resolveCredentialStatus({ provider: { credentialsRequired: true }, hasStoredCredential: true })).toBe('configured');
  });

  it('returns "unconfigured" when no credential is stored and one is required', () => {
    expect(resolveCredentialStatus({ provider: { credentialsRequired: true }, hasStoredCredential: false })).toBe('unconfigured');
  });

  it('defaults to requiring credentials when credentialsRequired is omitted', () => {
    expect(resolveCredentialStatus({ provider: {}, hasStoredCredential: false })).toBe('unconfigured');
    expect(resolveCredentialStatus({ provider: {}, hasStoredCredential: true })).toBe('configured');
  });
});

describe('mergeModelOptions', () => {
  it('keeps fetched models first and appends non-duplicate suggested models', () => {
    const merged = mergeModelOptions({ fetchedModels: [{ id: 'gpt-5', label: 'GPT-5', providerId: 'openai' }], suggestedModels: [
        { id: 'gpt-5', label: 'stale suggested label', providerId: 'openai' },
        { id: 'gpt-5-mini', label: 'GPT-5 mini', providerId: 'openai' },
      ] }
    );
    expect(merged).toEqual([
      { id: 'gpt-5', label: 'GPT-5', providerId: 'openai' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini', providerId: 'openai' },
    ]);
  });

  it('drops blank ids and falls back to id when label is blank', () => {
    const merged = mergeModelOptions({ fetchedModels: [{ id: '  ', label: 'ignored', providerId: 'openai' }], suggestedModels: [{ id: 'model-x', label: '   ', providerId: 'openai' }] }
    );
    expect(merged).toEqual([{ id: 'model-x', label: 'model-x', providerId: 'openai' }]);
  });

  it('trims ids and labels', () => {
    const merged = mergeModelOptions({ fetchedModels: [{ id: ' spaced-id ', label: ' Spaced Label ', providerId: 'openai' }], suggestedModels: [] });
    expect(merged).toEqual([{ id: 'spaced-id', label: 'Spaced Label', providerId: 'openai' }]);
  });
});

describe('fingerprintCredential', () => {
  it('is deterministic for the same input', () => {
    expect(fingerprintCredential({ value: 'sk-abc123' })).toBe(fingerprintCredential({ value: 'sk-abc123' }));
  });

  it('differs for different inputs', () => {
    expect(fingerprintCredential({ value: 'sk-abc123' })).not.toBe(fingerprintCredential({ value: 'sk-abc124' }));
  });

  it('never contains the raw credential', () => {
    expect(fingerprintCredential({ value: 'sk-super-secret' })).not.toContain('sk-super-secret');
  });

  it('encodes the input length as a prefix', () => {
    expect(fingerprintCredential({ value: 'abc' })).toMatch(/^3:/);
    expect(fingerprintCredential({ value: '' })).toMatch(/^0:/);
  });
});

describe('modelCatalogCacheKey', () => {
  it('produces the same key for equivalent inputs modulo trailing slashes/whitespace', () => {
    const a = modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://api.openai.com/', credential: ' sk-key ' });
    const b = modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://api.openai.com', credential: 'sk-key' });
    expect(a).toBe(b);
  });

  it('differs when the provider, base URL, credential, or variant differs', () => {
    const base = modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://api.openai.com', credential: 'sk-key' });
    expect(modelCatalogCacheKey({ providerId: 'azure', baseUrl: 'https://api.openai.com', credential: 'sk-key' })).not.toBe(base);
    expect(modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://other.example.com', credential: 'sk-key' })).not.toBe(base);
    expect(modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://api.openai.com', credential: 'sk-other' })).not.toBe(base);
    expect(modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://api.openai.com', credential: 'sk-key' }, { variant: '2024-01-01' })).not.toBe(base);
  });

  it('does not leak the raw credential', () => {
    expect(modelCatalogCacheKey({ providerId: 'openai', baseUrl: 'https://api.openai.com', credential: 'sk-super-secret' })).not.toContain('sk-super-secret');
  });
});

describe('normalizeAgentModelChoice', () => {
  const agent = { models: [{ id: 'model-a', label: 'A', providerId: 'p' }, { id: 'model-b', label: 'B', providerId: 'p' }] };

  it('returns null when no model is configured', () => {
    expect(normalizeAgentModelChoice({ agent: agent, choice: undefined })).toBeNull();
    expect(normalizeAgentModelChoice({ agent: agent, choice: {} })).toBeNull();
  });

  it('returns null when the configured model is still in the catalogue', () => {
    expect(normalizeAgentModelChoice({ agent: agent, choice: { model: 'model-b' } })).toBeNull();
  });

  it('falls back to the first model when the configured model is stale', () => {
    expect(normalizeAgentModelChoice({ agent: agent, choice: { model: 'model-gone', reasoning: 'high' } })).toEqual({
      model: 'model-a',
      reasoning: 'high',
    });
  });

  it('returns null when the agent has no models to fall back to', () => {
    expect(normalizeAgentModelChoice({ agent: { models: [] }, choice: { model: 'model-gone' } })).toBeNull();
    expect(normalizeAgentModelChoice({ agent: null, choice: { model: 'model-gone' } })).toBeNull();
    expect(normalizeAgentModelChoice({ agent: undefined, choice: { model: 'model-gone' } })).toBeNull();
  });
});

describe('effectiveAgentModelChoice', () => {
  const agent = { models: [{ id: 'model-a', label: 'A', providerId: 'p' }] };

  it('returns the normalized choice when normalization applies', () => {
    expect(effectiveAgentModelChoice({ agent: agent, choice: { model: 'model-gone' } })).toEqual({ model: 'model-a' });
  });

  it('returns the original choice unchanged when normalization does not apply', () => {
    const choice = { model: 'model-a' };
    expect(effectiveAgentModelChoice({ agent: agent, choice: choice })).toBe(choice);
  });

  it('passes through undefined', () => {
    expect(effectiveAgentModelChoice({ agent: agent, choice: undefined })).toBeUndefined();
  });
});
