import { describe, expect, it } from 'vitest';
import {
  buildLegacyMaxTokensParam,
  buildMaxCompletionTokensParam,
  buildOpenAIChatTokenParam,
  isUnsupportedMaxTokensError,
  usesMaxCompletionTokens,
} from '../token-params.js';

describe('usesMaxCompletionTokens', () => {
  it('matches gpt-5 family', () => {
    expect(usesMaxCompletionTokens({ model: 'gpt-5' })).toBe(true);
    expect(usesMaxCompletionTokens({ model: 'gpt-5.1' })).toBe(true);
    expect(usesMaxCompletionTokens({ model: 'gpt-5-mini' })).toBe(true);
  });

  it('matches o1/o3/o4 families', () => {
    expect(usesMaxCompletionTokens({ model: 'o1' })).toBe(true);
    expect(usesMaxCompletionTokens({ model: 'o1-preview' })).toBe(true);
    expect(usesMaxCompletionTokens({ model: 'o3.mini' })).toBe(true);
    expect(usesMaxCompletionTokens({ model: 'o4-mini' })).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(usesMaxCompletionTokens({ model: '  GPT-5  ' })).toBe(true);
  });

  it('does not match legacy families', () => {
    expect(usesMaxCompletionTokens({ model: 'gpt-4o' })).toBe(false);
    expect(usesMaxCompletionTokens({ model: 'gpt-4' })).toBe(false);
    expect(usesMaxCompletionTokens({ model: 'o200k' })).toBe(false);
    expect(usesMaxCompletionTokens({ model: 'claude-3-5-sonnet' })).toBe(false);
  });
});

describe('buildOpenAIChatTokenParam', () => {
  it('selects max_completion_tokens for the new families', () => {
    expect(buildOpenAIChatTokenParam({ model: 'gpt-5', maxTokens: 100 })).toEqual({ max_completion_tokens: 100 });
  });

  it('selects max_tokens for legacy families', () => {
    expect(buildOpenAIChatTokenParam({ model: 'gpt-4o', maxTokens: 100 })).toEqual({ max_tokens: 100 });
  });
});

describe('buildLegacyMaxTokensParam / buildMaxCompletionTokensParam', () => {
  it('always return their fixed shape', () => {
    expect(buildLegacyMaxTokensParam({ maxTokens: 42 })).toEqual({ max_tokens: 42 });
    expect(buildMaxCompletionTokensParam({ maxTokens: 42 })).toEqual({ max_completion_tokens: 42 });
  });
});

describe('isUnsupportedMaxTokensError', () => {
  it('detects the provider error text', () => {
    expect(
      isUnsupportedMaxTokensError({ detail: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." }
      ),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isUnsupportedMaxTokensError({ detail: 'UNSUPPORTED PARAMETER max_tokens max_completion_tokens' })).toBe(true);
  });

  it('returns false when any required substring is missing', () => {
    expect(isUnsupportedMaxTokensError({ detail: 'unsupported parameter max_tokens' })).toBe(false);
    expect(isUnsupportedMaxTokensError({ detail: 'some other error entirely' })).toBe(false);
  });
});
