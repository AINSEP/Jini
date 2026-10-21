import { describe, expect, test } from 'vitest';
import type { DnsPlanRequirement } from '../contract.js';
import { checkDelegation, settlePort } from '../delegation.js';
import { aggregatePropagation, answerMatches, isExpired, nextCheckDelayMs, PROPAGATION_CAP_MS, verifyRequirements } from '../verify.js';
import { fakeResolver } from './fakes.js';

describe('checkDelegation', () => {
  test('reads the NS set and reports it delegated', async () => {
    const resolver = fakeResolver({ ns: { 'example.test': ['NS2.host.test.', 'ns1.host.test', 'ns1.host.test'] } });
    const result = await checkDelegation({ zone: 'Example.Test.' }, { resolver });
    expect(result).toMatchObject({ zone: 'example.test', state: 'delegated', nameservers: ['ns1.host.test', 'ns2.host.test'], missing: [], unexpected: [] });
  });

  test('requires the expected set exactly, naming leftovers and missing servers', async () => {
    const resolver = fakeResolver({ ns: { 'example.test': ['ns1.old.test', 'ns1.new.test'] } });
    const wrong = await checkDelegation({ zone: 'example.test', expectedNameservers: ['NS1.new.test.', 'ns2.new.test'] }, { resolver });
    expect(wrong).toMatchObject({ state: 'not_delegated', missing: ['ns2.new.test'], unexpected: ['ns1.old.test'] });
    expect(wrong.reason).toContain('registrar');
    const right = await checkDelegation({ zone: 'example.test', expectedNameservers: ['ns1.new.test', 'ns1.old.test'] }, { resolver });
    expect(right.state).toBe('delegated');
  });

  test('NXDOMAIN or an empty NS set is not delegated', async () => {
    expect((await checkDelegation({ zone: 'gone.test' }, { resolver: fakeResolver({}) })).state).toBe('not_delegated');
    expect((await checkDelegation({ zone: 'empty.test' }, { resolver: fakeResolver({ ns: { 'empty.test': [] } }) })).state).toBe('not_delegated');
  });

  test.each(['timeout', 'refused', 'throw'] as const)('a %s answer is unknown, never not_delegated', async answer => {
    const result = await checkDelegation({ zone: 'example.test' }, { resolver: fakeResolver({ ns: { 'example.test': answer } }) });
    expect(result.state).toBe('unknown');
    expect(result.nameservers).toEqual([]);
  });

  test('settlePort turns a throw into an unknown network outcome', async () => {
    expect(await settlePort({ call: async () => { throw new Error('boom'); } })).toMatchObject({ status: 'unknown', error: { code: 'network' } });
  });
});

describe('backoff and expiry', () => {
  test('starts at 30s, doubles, caps at 10 minutes and clamps bad attempts', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(attempt => nextCheckDelayMs({ attempt }))).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
    expect(nextCheckDelayMs({ attempt: -3 })).toBe(30_000);
  });
  test('expires after 48 hours', () => {
    expect(isExpired({ startedAt: 1000, now: 1000 + PROPAGATION_CAP_MS - 1 })).toBe(false);
    expect(isExpired({ startedAt: 1000, now: 1000 + PROPAGATION_CAP_MS })).toBe(true);
  });
});

describe('answerMatches', () => {
  test('compares typed values', () => {
    expect(answerMatches({ record: { type: 'CNAME', name: 'w.test', value: 'Host.Test' }, answer: 'host.test.' })).toBe(true);
    expect(answerMatches({ record: { type: 'A', name: 'w.test', value: '192.0.2.1' }, answer: '192.0.2.2' })).toBe(false);
    expect(answerMatches({ record: { type: 'TXT', name: 'w.test', value: 'abc' }, answer: '"a" "bc"' })).toBe(true);
  });
  test('MX priority matters only when required', () => {
    expect(answerMatches({ record: { type: 'MX', name: 'w.test', value: 'mx.test' }, answer: '50 mx.test.' })).toBe(true);
    expect(answerMatches({ record: { type: 'MX', name: 'w.test', value: 'mx.test', priority: 10 }, answer: '50 mx.test.' })).toBe(false);
    expect(answerMatches({ record: { type: 'MX', name: 'w.test', value: 'mx.test' }, answer: 'garbage' })).toBe(false);
  });
  test('an SPF requirement is satisfied by a merged SPF record', () => {
    const record = { type: 'TXT' as const, name: 'w.test', value: 'v=spf1 include:b.test -all' };
    expect(answerMatches({ record, answer: '"v=spf1 include:a.test include:b.test ~all"' })).toBe(true);
    expect(answerMatches({ record, answer: '"v=spf1 include:a.test ~all"' })).toBe(false);
    expect(answerMatches({ record, answer: '"unrelated include:b.test"' })).toBe(false);
  });
  test('a malformed CAA requirement never matches', () => {
    expect(answerMatches({ record: { type: 'CAA', name: 'w.test', value: 'nonsense' }, answer: '0 issue "ca.test"' })).toBe(false);
  });
});

describe('verifyRequirements', () => {
  const requirement = (records: DnsPlanRequirement['records']): DnsPlanRequirement => ({ purpose: 'site', domain: 'www.example.test', providerId: 'host', records });
  const www = { type: 'A' as const, name: 'WWW.example.test.', value: '192.0.2.1' };
  const ns = { 'example.test': ['ns1.host.test', 'ns2.host.test'] };

  test('asks every authoritative nameserver and reports propagated when all agree', async () => {
    const resolver = fakeResolver({ ns, records: { 'www.example.test|A': ['192.0.2.1'] } });
    const result = await verifyRequirements({ zone: 'example.test', requirements: [requirement([www])] }, { resolver });
    expect(result.state).toBe('propagated');
    expect(result.nameservers).toEqual(['ns1.host.test', 'ns2.host.test']);
    expect(result.records[0]?.byNameserver.map(observation => observation.nameserver)).toEqual(['ns1.host.test', 'ns2.host.test']);
    expect(resolver.queries).toContain('ns2.host.test www.example.test A');
  });

  test('one server still answering old data keeps the record pending', async () => {
    const resolver = fakeResolver({ ns, records: { 'ns1.host.test|www.example.test|A': ['192.0.2.1'], 'ns2.host.test|www.example.test|A': ['192.0.2.9'] } });
    expect((await verifyRequirements({ zone: 'example.test', requirements: [requirement([www])] }, { resolver })).state).toBe('pending');
  });

  test('wrong data everywhere is a mismatch, and outranks other records', async () => {
    const resolver = fakeResolver({ ns, records: { 'www.example.test|A': ['192.0.2.9'], 'www.example.test|TXT': 'timeout' } });
    const result = await verifyRequirements({ zone: 'example.test', requirements: [requirement([www, { type: 'TXT', name: 'www.example.test', value: 'x' }])] }, { resolver });
    expect(result.records.map(record => record.state)).toEqual(['mismatch', 'unknown']);
    expect(result.state).toBe('mismatch');
  });

  test('missing data (NODATA/NXDOMAIN) is pending; transport failures are unknown', async () => {
    const pending = fakeResolver({ ns, records: { 'ns1.host.test|www.example.test|A': [], 'ns2.host.test|www.example.test|A': 'nxdomain' } });
    expect((await verifyRequirements({ zone: 'example.test', requirements: [requirement([www])] }, { resolver: pending })).state).toBe('pending');
    for (const failure of ['refused', 'throw', 'timeout'] as const) {
      const resolver = fakeResolver({ ns, records: { 'ns1.host.test|www.example.test|A': ['192.0.2.1'], 'ns2.host.test|www.example.test|A': failure } });
      const result = await verifyRequirements({ zone: 'example.test', requirements: [requirement([www])] }, { resolver });
      expect(result.state).toBe('unknown');
      expect(result.records[0]?.byNameserver[1]?.state).toBe('unknown');
    }
  });

  test('without readable nameservers every record is unknown', async () => {
    const failing = await verifyRequirements({ zone: 'example.test', requirements: [requirement([www])] }, { resolver: fakeResolver({ ns: { 'example.test': 'timeout' } }) });
    expect(failing).toMatchObject({ state: 'unknown', nameservers: [], records: [{ state: 'unknown', byNameserver: [] }] });
    expect(failing.reason).toMatch(/could not be read/);
    const empty = await verifyRequirements({ zone: 'example.test', requirements: [requirement([www])] }, { resolver: fakeResolver({ ns: { 'example.test': [] } }) });
    expect(empty.reason).toMatch(/no authoritative nameservers/);
  });

  test('aggregate ranks mismatch over unknown over pending', () => {
    expect(aggregatePropagation({ states: [] })).toBe('propagated');
    expect(aggregatePropagation({ states: ['pending', 'unknown'] })).toBe('unknown');
    expect(aggregatePropagation({ states: ['pending', 'propagated'] })).toBe('pending');
    expect(aggregatePropagation({ states: ['unknown', 'mismatch'] })).toBe('mismatch');
  });
});
