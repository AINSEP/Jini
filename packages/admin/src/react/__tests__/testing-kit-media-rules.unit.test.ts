import { expect, it } from 'vitest';
import { fakeAdminKit } from '../testing-kit.js';

const { rules } = fakeAdminKit().mediaProviders;

// The fake stands in for a host's rules in every admin test, so it must answer the cases the real rules
// document: markers say "a key exists", typed values are what can be re-sent.
it('treats an entry as marker-only exactly when it is configured and holds no typed value', () => {
  expect(rules.isMarkerOnlyEntry({ apiKeyConfigured: true })).toBe(true);
  expect(rules.isMarkerOnlyEntry({ apiKeyTail: '1234' })).toBe(true);
  expect(rules.isMarkerOnlyEntry({ apiKeyTail: '1234', baseUrl: 'https://a.test' })).toBe(false);
  expect(rules.isMarkerOnlyEntry({ apiKeyConfigured: true, model: 'm' })).toBe(false);
  expect(rules.isMarkerOnlyEntry({ apiKey: 'sk-typed', apiKeyTail: '1234' })).toBe(false);
  expect(rules.isMarkerOnlyEntry({})).toBe(false);
  expect(rules.isMarkerOnlyEntry(undefined)).toBe(false);
});
