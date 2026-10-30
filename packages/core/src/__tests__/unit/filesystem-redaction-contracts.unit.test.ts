import { expect, it } from 'vitest';
import { FsFilePathError } from '../../filesystem.js';
import { redactSecretsWithCounts } from '../../redact.js';
import { legacyCoreRedactSecrets, legacyCoreWithCounts, legacyCliRedactSecretLike, legacyProviderRedactSecrets } from '../fixtures/legacy-redactors.js';

it('path refusals retain Error identity, the actionable message and a distinct error name', () => {
  const error = new FsFilePathError({ message: 'path escapes workspace' });
  expect(error).toBeInstanceOf(Error); expect(error).toBeInstanceOf(FsFilePathError);
  expect(error.name).toBe('FsFilePathError'); expect(error.message).toBe('path escapes workspace');
});

it.each([
  { input: '', expected: { redacted: '', counts: {} } },
  { input: 'api-key: short', expected: { redacted: 'api-key: [REDACTED:api_key_header]', counts: { api_key_header: 1 } } },
  { input: '"x-api-key": "short"', expected: { redacted: '"x-api-key": "[REDACTED:api_key_header]"', counts: { api_key_header: 1 } } },
  { input: '/?key=short&api_key=other', expected: { redacted: '/?key=[REDACTED:api_key_query]&api_key=[REDACTED:api_key_query]', counts: { api_key_query: 2 } } },
  { input: '5500 0000 0000 0004', expected: { redacted: '[REDACTED:credit_card]', counts: { credit_card: 1 } } },
  { input: '5500 0000 0000 0005', expected: { redacted: '5500 0000 0000 0005', counts: {} } },
])('preserves the frozen core redaction contract and counters for $input', ({ input, expected }) => {
  expect(legacyCoreRedactSecrets({ input })).toBe(expected.redacted);
  expect(legacyCoreWithCounts({ input })).toEqual(expected);
  expect(redactSecretsWithCounts({ input })).toEqual(expected);
});

it('legacy CLI keeps approved correlation IDs while redacting opaque credential runs', () => {
  expect(legacyCliRedactSecretLike({ text: 'ERR-AAAA-BBBB-CCCC-DDDD delegated-tool-calls ' + 'a'.repeat(24) }))
    .toBe('ERR-AAAA-BBBB-CCCC-DDDD delegated-tool-calls [redacted]');
});

it('legacy provider handles empty text and ignores empty optional exact secrets', () => {
  expect(legacyProviderRedactSecrets({ text: '' })).toBe('');
  expect(legacyProviderRedactSecrets({ text: 'echo literal.* echo literal.*' }, { exactSecrets: ['', undefined, null, 'literal.*'] }))
    .toBe('echo [REDACTED] echo [REDACTED]');
});
