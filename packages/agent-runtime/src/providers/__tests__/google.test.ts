import { describe, expect, it } from 'vitest';
import {
  googleGenerateContentUrl,
  googleGenerativeLanguageBaseUrl,
  googleModelPathSegment,
  googleProviderModelsUrl,
  googleStreamGenerateContentUrl,
  normalizeGoogleModelId,
} from '../google.js';

describe('googleGenerativeLanguageBaseUrl', () => {
  it('strips a trailing /v1beta segment', () => {
    expect(googleGenerativeLanguageBaseUrl({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })).toBe(
      'https://generativelanguage.googleapis.com',
    );
  });

  it('strips a trailing /v1 segment', () => {
    expect(googleGenerativeLanguageBaseUrl({ baseUrl: 'https://example.com/v1' })).toBe('https://example.com');
  });

  it('strips trailing slashes and query/hash', () => {
    expect(googleGenerativeLanguageBaseUrl({ baseUrl: 'https://example.com/base/?x=1#frag' })).toBe(
      'https://example.com/base',
    );
  });

  it('keeps the root path as empty (not a bare slash) after normalization', () => {
    expect(googleGenerativeLanguageBaseUrl({ baseUrl: 'https://example.com/' })).toBe('https://example.com');
  });
});

describe('normalizeGoogleModelId', () => {
  it('strips the models/ prefix', () => {
    expect(normalizeGoogleModelId({ model: 'models/gemini-2.0-flash' })).toBe('gemini-2.0-flash');
  });

  it('trims whitespace and leaves a bare id unchanged', () => {
    expect(normalizeGoogleModelId({ model: '  gemini-2.0-flash  ' })).toBe('gemini-2.0-flash');
  });
});

describe('googleModelPathSegment', () => {
  it('url-encodes a normalized model id', () => {
    expect(googleModelPathSegment({ model: 'models/gemini 2.0' })).toBe('gemini%202.0');
  });
});

describe('googleGenerateContentUrl / googleStreamGenerateContentUrl', () => {
  it('builds the non-streaming endpoint', () => {
    expect(googleGenerateContentUrl({ baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash' })).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    );
  });

  it('builds the streaming endpoint with alt=sse', () => {
    expect(googleStreamGenerateContentUrl({ baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash' })).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse',
    );
  });
});

describe('googleProviderModelsUrl', () => {
  it('attaches the api key as a query param', () => {
    const url = googleProviderModelsUrl({ baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'secret-key' });
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=secret-key');
  });
});
