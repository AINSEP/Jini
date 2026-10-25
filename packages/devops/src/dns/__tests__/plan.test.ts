import { describe, expect, test } from 'vitest';
import type { DomainRecordRequirement } from '@jini-ai/core/provider-registry';
import type { DnsPlanRequirement, DnsRecord } from '../contract.js';
import { fingerprintPlan, planDnsChanges } from '../plan.js';

const zone = 'example.test';
const req = (records: DomainRecordRequirement[], extra: Partial<DnsPlanRequirement> = {}): DnsPlanRequirement => ({ purpose: 'site', domain: 'www.example.test', providerId: 'host', records, ...extra });
const plan = (current: DnsRecord[], requirements: DnsPlanRequirement[], optional = {}) => planDnsChanges({ providerId: 'manual', zone, current, requirements, inventory: 'complete' }, optional);
const A = (name: string, ...values: string[]): DnsRecord => ({ name, type: 'A', ttl: 300, values });
/** A record this engine created, so the planner may replace or delete it. */
const own = (record: DnsRecord): DnsRecord => ({ ...record, managedBy: 'self' });

describe('inventory gate', () => {
  test.each(['partial', 'unknown'] as const)('a %s inventory yields zero changes and a blocker', inventory => {
    const current = [A('WWW.example.test.', '192.0.2.9')];
    const result = planDnsChanges({ providerId: 'p', zone: 'Example.Test.', current, requirements: [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }])], inventory });
    expect(result.changes).toEqual([]);
    expect(result.zone).toBe('example.test');
    expect(result.preserved).toEqual([A('www.example.test', '192.0.2.9')]);
    expect(result.blockers.map(blocker => blocker.code)).toEqual(['inventory_incomplete']);
    expect(result.inventory).toBe(inventory);
  });
});

describe('address records', () => {
  test('creates missing records with a deterministic sha-256 fingerprint', () => {
    const requirements = [req([{ type: 'A', name: 'example.test', value: '192.0.2.1' }, { type: 'TXT', name: '_verify.example.test', value: 'token-1' }])];
    const first = plan([], requirements);
    expect(first.changes.map(change => [change.op, change.after?.type, change.after?.name])).toEqual([
      ['create', 'TXT', '_verify.example.test'], ['create', 'A', 'example.test'],
    ]);
    expect(first.blockers).toEqual([]);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan([], requirements).fingerprint).toBe(first.fingerprint);
    expect(plan([A('other.example.test', '192.0.2.2')], requirements).fingerprint).not.toBe(first.fingerprint);
  });

  test('replaces only conflicting address records and preserves mail, TXT and wildcards', () => {
    const mx: DnsRecord = { name: 'example.test', type: 'MX', ttl: 300, values: [{ priority: 10, exchange: 'mx.mail.test' }] };
    const wildcard = A('*.example.test', '192.0.2.50');
    const txt: DnsRecord = { name: 'www.example.test', type: 'TXT', ttl: 300, values: ['keep-me'] };
    const current: DnsRecord[] = [own(A('www.example.test', '192.0.2.9')), own({ name: 'www.example.test', type: 'AAAA', ttl: 300, values: ['2001:db8::9'] }), mx, wildcard, txt];
    const result = plan(current, [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }])]);
    expect(result.changes.map(change => change.op)).toEqual(['delete', 'update']);
    expect(result.changes[0]?.before?.type).toBe('AAAA');
    expect(result.changes[1]?.after?.values).toEqual(['192.0.2.1']);
    expect(result.preserved).toEqual([mx, wildcard, txt]);
  });

  test('replaces an existing CNAME with required A and AAAA records, deletes first', () => {
    const current: DnsRecord[] = [own({ name: 'app.example.test', type: 'CNAME', ttl: 300, values: ['old.host.test'] })];
    const result = plan(current, [req([{ type: 'AAAA', name: 'app.example.test', value: '2001:db8::1' }, { type: 'A', name: 'app.example.test', value: '192.0.2.1' }])]);
    expect(result.changes.map(change => `${change.op}:${(change.after ?? change.before)?.type}`)).toEqual(['delete:CNAME', 'create:A', 'create:AAAA']);
    expect(result.changes[0]?.reason).toContain('A/AAAA');
  });

  test('leaves a satisfied record alone and keeps the provider handle on update', () => {
    const have: DnsRecord = { ...A('www.example.test', '192.0.2.1', '192.0.2.2'), providerRef: 'rec-1', managedBy: 'other' };
    expect(plan([have], [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.2' }, { type: 'A', name: 'www.example.test', value: '192.0.2.1' }])]).changes).toEqual([]);
    const owned = own(have);
    const updated = plan([owned], [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.3', ttl: 60 }])]).changes[0];
    expect(updated).toMatchObject({ op: 'update', before: owned, after: { providerRef: 'rec-1', ttl: 60, values: ['192.0.2.3'] } });
  });

  test('refuses an apex CNAME without flattening and suggests ALIAS/A', () => {
    const result = plan([], [req([{ type: 'CNAME', name: 'example.test', value: 'target.host.test' }])]);
    expect(result.changes).toEqual([]);
    expect(result.blockers).toMatchObject([{ code: 'apex_cname', name: 'example.test' }]);
    expect(result.blockers[0]?.suggestion).toMatch(/ALIAS/);
  });

  test('allows a flattened apex CNAME beside apex mail records', () => {
    const mx: DnsRecord = { name: 'example.test', type: 'MX', ttl: 300, values: [{ priority: 10, exchange: 'mx.test' }] };
    const result = plan([mx, own(A('example.test', '192.0.2.9'))], [req([{ type: 'CNAME', name: 'example.test', value: 'target.host.test.' }])], { apexFlattening: true });
    expect(result.blockers).toEqual([]);
    expect(result.changes.map(change => change.op)).toEqual(['delete', 'create']);
    expect(result.changes[1]?.after?.values).toEqual(['target.host.test']);
    expect(result.preserved).toEqual([mx]);
  });

  test('refuses a CNAME that would coexist with other records at the same name', () => {
    const txt: DnsRecord = { name: 'www.example.test', type: 'TXT', ttl: 300, values: ['keep'] };
    const desiredCname = { type: 'CNAME' as const, name: 'www.example.test', value: 'host.test' };
    expect(plan([txt], [req([desiredCname])]).blockers.map(blocker => blocker.code)).toEqual(['cname_coexistence']);
    expect(plan([], [req([desiredCname, { type: 'TXT', name: 'www.example.test', value: 'x' }])]).blockers.map(blocker => blocker.code)).toEqual(['cname_coexistence']);
    const existingCname: DnsRecord = { name: 'www.example.test', type: 'CNAME', ttl: 300, values: ['host.test'] };
    const blocked = plan([existingCname], [req([{ type: 'TXT', name: 'www.example.test', value: 'verify' }])]);
    expect(blocked.blockers).toMatchObject([{ code: 'cname_coexistence', name: 'www.example.test' }]);
    expect(blocked.changes).toEqual([]);
    expect(plan([existingCname], [req([desiredCname])]).changes).toEqual([]);
  });
});

describe('address records: what may be replaced', () => {
  // Regression (review 13-dns #1): a TXT/MX-only requirement used to plan the deletion of every
  // address record at its name, because an empty desired address set "conflicted" with them all.
  test('a TXT/MX-only requirement preserves the A/AAAA records at its name', () => {
    const a = own(A('example.test', '192.0.2.9'));
    const aaaa: DnsRecord = own({ name: 'example.test', type: 'AAAA', ttl: 300, values: ['2001:db8::9'] });
    const result = plan([a, aaaa], [req([{ type: 'TXT', name: 'example.test', value: 'v=spf1 include:mail.test -all' }, { type: 'MX', name: 'example.test', value: 'mx.mail.test' }])]);
    expect(result.changes.map(change => `${change.op}:${(change.after ?? change.before)?.type}`)).toEqual(['create:MX', 'create:TXT']);
    expect(result.preserved).toEqual([a, aaaa]);
    expect(result.blockers).toEqual([]);
  });

  // Regression (review 13-dns #2): records nobody marked as ours were deleted or overwritten.
  test.each([['other' as const], [undefined]])('a record managed by %s is preserved behind an ownership blocker', managedBy => {
    const foreignA: DnsRecord = { ...A('www.example.test', '192.0.2.9'), ...(managedBy ? { managedBy } : {}) };
    const replaced = plan([foreignA], [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }])]);
    expect(replaced.changes).toEqual([]);
    expect(replaced.preserved).toEqual([foreignA]);
    expect(replaced.blockers).toMatchObject([{ code: 'record_not_owned', name: 'www.example.test' }]);
    expect(replaced.blockers[0]?.message).toContain('A record at www.example.test');
    expect(replaced.blockers[0]?.suggestion).toContain('A 192.0.2.1');
    const foreignCname: DnsRecord = { name: 'www.example.test', type: 'CNAME', ttl: 300, values: ['old.host.test'], ...(managedBy ? { managedBy } : {}) };
    const deleted = plan([foreignCname], [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }])]);
    expect(deleted.changes).toEqual([]);
    expect(deleted.blockers).toMatchObject([{ code: 'record_not_owned', name: 'www.example.test' }]);
  });

  test('an owned record beside a foreign one at the same name still blocks the whole name', () => {
    const result = plan([own(A('www.example.test', '192.0.2.9')), { name: 'www.example.test', type: 'AAAA', ttl: 300, values: ['2001:db8::9'], managedBy: 'other' }], [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }, { type: 'TXT', name: 'www.example.test', value: 'keep-going' }])]);
    expect(result.changes.map(change => `${change.op}:${(change.after ?? change.before)?.type}`)).toEqual(['create:TXT']);
    expect(result.blockers).toMatchObject([{ code: 'record_not_owned', name: 'www.example.test' }]);
  });
});

describe('additive records', () => {
  test('merges TXT values into the existing set and skips a satisfied one', () => {
    const have: DnsRecord = { name: '_v.example.test', type: 'TXT', ttl: 120, values: ['other'] };
    const result = plan([have], [req([{ type: 'TXT', name: '_v.example.test', value: 'token' }])]);
    expect(result.changes).toMatchObject([{ op: 'update', after: { ttl: 120, values: ['other', 'token'] } }]);
    expect(plan([have], [req([{ type: 'TXT', name: '_v.example.test', value: 'other' }])]).changes).toEqual([]);
  });

  test('merges SPF into the single existing v=spf1 record and never adds a second one', () => {
    const have: DnsRecord = { name: 'example.test', type: 'TXT', ttl: 300, values: ['google-site-verification=1', 'v=spf1 include:a.test ~all'] };
    const merged = plan([have], [req([{ type: 'TXT', name: 'example.test', value: 'v=spf1 include:b.test -all' }])]);
    expect(merged.changes[0]?.after?.values).toEqual(['google-site-verification=1', 'v=spf1 include:a.test include:b.test ~all']);
    expect(plan([have], [req([{ type: 'TXT', name: 'example.test', value: 'v=spf1 include:a.test -all' }])]).changes).toEqual([]);
    const plain: DnsRecord = { name: 'example.test', type: 'TXT', ttl: 300, values: ['other'] };
    expect(plan([plain], [req([{ type: 'TXT', name: 'example.test', value: 'v=spf1 mx -all' }])]).changes[0]?.after?.values).toEqual(['other', 'v=spf1 mx -all']);
  });

  test('merges SPF from two requirements into one created record', () => {
    const result = plan([], [req([{ type: 'TXT', name: 'example.test', value: 'v=spf1 include:a.test -all' }]), req([{ type: 'TXT', name: 'example.test', value: '"v=spf1 include:b.test ~all"' }], { purpose: 'mail' })]);
    expect(result.changes).toMatchObject([{ op: 'create', after: { type: 'TXT', values: ['v=spf1 include:a.test include:b.test -all'] } }]);
  });

  test('blocks when the name already carries two SPF records', () => {
    const have: DnsRecord = { name: 'example.test', type: 'TXT', ttl: 300, values: ['v=spf1 a -all', 'v=spf1 mx -all'] };
    const result = plan([have], [req([{ type: 'TXT', name: 'example.test', value: 'v=spf1 include:b.test -all' }])]);
    expect(result.changes).toEqual([]);
    expect(result.blockers).toMatchObject([{ code: 'multiple_spf', name: 'example.test' }]);
  });

  test('adds MX and CAA values beside existing ones', () => {
    const mx: DnsRecord = { name: 'send.example.test', type: 'MX', ttl: 300, values: [{ priority: 10, exchange: 'old.mx.test' }] };
    const result = plan([mx], [req([{ type: 'MX', name: 'send.example.test', value: 'new.mx.test', priority: 20 }, { type: 'CAA', name: 'example.test', value: '0 issue "ca.test"' }])]);
    expect(result.changes).toMatchObject([
      { op: 'update', after: { values: [{ priority: 10, exchange: 'old.mx.test' }, { priority: 20, exchange: 'new.mx.test' }] } },
      { op: 'create', after: { type: 'CAA', values: [{ flags: 0, tag: 'issue', value: 'ca.test' }] } },
    ]);
    expect(plan([mx], [req([{ type: 'MX', name: 'send.example.test', value: 'old.mx.test' }])]).changes).toEqual([]);
  });

  test('uses the smallest TTL among duplicate requirement records and the default otherwise', () => {
    const result = plan([], [req([{ type: 'A', name: 'a.example.test', value: '192.0.2.1', ttl: 600 }, { type: 'A', name: 'a.example.test', value: '192.0.2.1', ttl: 60 }, { type: 'A', name: 'b.example.test', value: '192.0.2.1' }])], { defaultTtl: 900 });
    expect(result.changes.map(change => [change.after?.name, change.after?.ttl, change.after?.values])).toEqual([
      ['a.example.test', 60, ['192.0.2.1']], ['b.example.test', 900, ['192.0.2.1']],
    ]);
  });
});

describe('plan blockers', () => {
  test('reports an unparseable requirement', () => {
    const result = plan([], [req([{ type: 'CAA', name: 'example.test', value: 'garbage' }])]);
    expect(result.blockers).toMatchObject([{ code: 'invalid_requirement', name: 'example.test' }]);
    expect(result.changes).toEqual([]);
  });

  test('blocks a record type the host cannot serve and skips that name', () => {
    const result = plan([], [req([{ type: 'SRV', name: '_sip.example.test', value: '0 5 5060 sip.test' }, { type: 'A', name: 'www.example.test', value: '192.0.2.1' }])], { recordTypes: ['A'] });
    expect(result.blockers).toMatchObject([{ code: 'unsupported_record_type', name: '_sip.example.test' }]);
    expect(result.changes.map(change => change.after?.name)).toEqual(['www.example.test']);
  });

  const caa = (name: string, ...values: [string, string][]): DnsRecord => ({ name, type: 'CAA', ttl: 300, values: values.map(([tag, value]) => ({ flags: 0, tag: tag as 'issue', value })) });
  const site = (extra: Partial<DnsPlanRequirement> = {}) => req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }], { caa: { issuer: 'LetsEncrypt.org' }, ...extra });

  test('blocks when the closest CAA set does not authorize the required CA', () => {
    const result = plan([caa('example.test', ['issue', 'other-ca.test'])], [site()]);
    expect(result.blockers).toMatchObject([{ code: 'caa_excludes_issuer', name: 'www.example.test' }]);
    expect(result.changes).toHaveLength(1);
  });

  test('accepts an authorizing, parameterised, iodef-only or absent CAA set', () => {
    expect(plan([caa('example.test', ['issue', 'letsencrypt.org; validationmethods=dns-01'])], [site()]).blockers).toEqual([]);
    expect(plan([caa('example.test', ['iodef', 'mailto:x@example.test'])], [site()]).blockers).toEqual([]);
    expect(plan([], [site()]).blockers).toEqual([]);
    expect(plan([caa('example.test', ['issue', 'other-ca.test'])], [req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }])]).blockers).toEqual([]);
  });

  test('a closer CAA set (existing or required) overrides the parent', () => {
    expect(plan([caa('example.test', ['issue', 'other-ca.test']), caa('www.example.test', ['issue', 'letsencrypt.org'])], [site()]).blockers).toEqual([]);
    const adds = req([{ type: 'A', name: 'www.example.test', value: '192.0.2.1' }, { type: 'CAA', name: 'example.test', value: '0 issue "letsencrypt.org"' }], { caa: { issuer: 'letsencrypt.org' } });
    expect(plan([caa('example.test', ['issue', 'other-ca.test'])], [adds]).blockers).toEqual([]);
  });

  test('wildcard names are checked against issuewild when present', () => {
    const wild = req([{ type: 'A', name: '*.example.test', value: '192.0.2.1' }], { domain: '*.example.test', caa: { issuer: 'letsencrypt.org' } });
    expect(plan([caa('example.test', ['issue', 'letsencrypt.org'], ['issuewild', ';'])], [wild]).blockers).toMatchObject([{ code: 'caa_excludes_issuer', name: '*.example.test' }]);
    expect(plan([caa('example.test', ['issue', 'letsencrypt.org'])], [wild]).blockers).toEqual([]);
  });
});

describe('canonical JSON and fingerprints', () => {
  test('ignores a fingerprint already present on the plan', () => {
    const body = { providerId: 'p', zone, changes: [], preserved: [], inventory: 'complete' as const, blockers: [] };
    expect(fingerprintPlan({ plan: { ...body, fingerprint: 'stale' } })).toBe(fingerprintPlan({ plan: body }));
  });
});
