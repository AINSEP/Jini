import { expect, it } from 'vitest';
import { DNS_TYPES, DomainDnsInputError } from '../public-dns-vocabulary.js';

it('publishes only the supported public DNS queries', () => {
  expect([...DNS_TYPES].sort()).toEqual(['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT']);
});

it('gives adapters a distinguishable DNS input error without losing the reason', () => {
  const error = new DomainDnsInputError({ message: 'Enter a hostname without a path.' });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('DomainDnsInputError');
  expect(error.message).toBe('Enter a hostname without a path.');
});
