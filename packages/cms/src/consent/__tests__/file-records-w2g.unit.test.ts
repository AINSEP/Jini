import { expect, test, vi } from 'vitest';
import { consentRateLimitKey, createConsentFileRecords } from '../node/index.js';
import { accepted } from './fixtures.js';

test('the file-record adapter exposes retirement only with the host port and preserves its error', async () => {
  const readText = vi.fn(async () => null);
  const writeJson = vi.fn(async () => {});
  const ordinary = createConsentFileRecords({ directory: '/receipts', files: { readText, writeJson } });
  expect(Object.hasOwn(ordinary, 'retire')).toBe(false);
  const failure = new Error('archive failed');
  const retire = vi.fn(async () => { throw failure; });
  const records = createConsentFileRecords({ directory: '/receipts', files: { readText, writeJson, retire } });
  await expect(records.retire!({ id: accepted.id })).rejects.toBe(failure);
  expect(retire).toHaveBeenCalledWith({ filePath: `/receipts/${accepted.id}.json` });
  await expect(records.retire!({ id: '../escape' })).rejects.toThrow('Invalid consent receipt ID');
  expect(retire).toHaveBeenCalledTimes(1);
});

test.each([
  ['::ffff:192.0.2.1', '192.0.2.1'], ['0:0:0:0:0:ffff:c000:201', '192.0.2.1'],
  ['::', '0:0:0:0::/64'], ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
  ['fe80::1234%en0', 'fe80:0:0:0::/64'], ['not-an-address', 'not-an-address'],
] as const)('receipt rate limit groups native IP spelling %s as %s', (address, expected) => {
  expect(consentRateLimitKey({ address })).toBe(expected);
});
