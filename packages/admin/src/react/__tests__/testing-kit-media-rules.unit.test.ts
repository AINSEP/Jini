import { expect, it } from 'vitest';
import { fakeAdminKit } from '../testing-kit.js';

const { rules } = fakeAdminKit().mediaProviders;

// The fake stands in for a host's rules in every admin test, so it must answer the cases the real rules
// document: markers say "a key exists", typed values are what can be re-sent.
it('treats an entry as marker-only exactly when it is configured and holds no typed value', () => {
  expect(rules.isMarkerOnlyEntry({ entry: { apiKeyConfigured: true } })).toBe(true);
  expect(rules.isMarkerOnlyEntry({ entry: { apiKeyTail: '1234' } })).toBe(true);
  expect(rules.isMarkerOnlyEntry({ entry: { apiKeyTail: '1234', baseUrl: 'https://a.test' } })).toBe(false);
  expect(rules.isMarkerOnlyEntry({ entry: { apiKeyConfigured: true, model: 'm' } })).toBe(false);
  expect(rules.isMarkerOnlyEntry({ entry: { apiKey: 'sk-typed', apiKeyTail: '1234' } })).toBe(false);
  expect(rules.isMarkerOnlyEntry({ entry: {} })).toBe(false);
  expect(rules.isMarkerOnlyEntry({ entry: undefined })).toBe(false);
});

it('masks only the last four characters and returns no label when no key marker exists', () => {
  expect(rules.maskedKeyLabel({ entry: { apiKey: 'typed-7719', apiKeyTail: '  old-8823  ' } })).toBe('••••8823');
  expect(rules.maskedKeyLabel({ entry: { apiKey: ' typed-7719 ' } })).toBe('••••7719');
  expect(rules.maskedKeyLabel({ entry: { apiKeyConfigured: true } })).toBe('••••');
  expect(rules.maskedKeyLabel({ entry: { model: 'not-a-key' } })).toBeNull();
});

it('reports only invalid nonblank provider endpoints in the view', () => {
  const providers = {
    blank: { baseUrl: '  ' }, malformed: { baseUrl: 'provider.test' },
    wrongScheme: { baseUrl: 'ftp://provider.test' }, https: { baseUrl: ' https://provider.test/v1 ' },
  };
  expect(rules.invalidBaseUrlProviderIds({ providers: null })).toEqual([]);
  expect(rules.invalidBaseUrlProviderIds({ providers })).toEqual(['malformed', 'wrongScheme']);
});
