import { describe, expect, it } from 'vitest';
import { accountFailureDetails, noopAccountFailureClassifier } from '../account-failure.js';

describe('noopAccountFailureClassifier', () => {
  it('always returns null, regardless of input', () => {
    expect(noopAccountFailureClassifier.classify({ text: 'insufficient balance' })).toBeNull();
    expect(noopAccountFailureClassifier.classify({ text: '' })).toBeNull();
    expect(noopAccountFailureClassifier.classify({ text: 'auth required' })).toBeNull();
  });
});

describe('accountFailureDetails', () => {
  it('includes actionUrl when present', () => {
    expect(
      accountFailureDetails({ code: 'X', message: 'm', action: 'recharge', actionUrl: 'https://example.com' }),
    ).toEqual({ kind: 'account_failure', action: 'recharge', actionUrl: 'https://example.com' });
  });

  it('omits actionUrl when absent', () => {
    expect(accountFailureDetails({ code: 'X', message: 'm', action: 'relogin' })).toEqual({
      kind: 'account_failure',
      action: 'relogin',
    });
  });
});
