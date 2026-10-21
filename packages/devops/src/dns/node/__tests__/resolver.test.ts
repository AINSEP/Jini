import { describe, expect, test } from 'vitest';
import { AUTHORITATIVE_DNS_TIMEOUT_MS, createNodeAuthoritativeDnsResolver, type DnsResolverLike } from '../resolver.js';
import type { DnsExchange } from '../udp.js';
import { dnsReply, nsRecord } from './wire-fixtures.js';

/**
 * The `node:dns` authoritative adapter with a fake Resolver factory and a fake raw exchange (no
 * network): answers are rendered in the presentation format the kernel parses, record queries go to
 * the nameserver's own public address, the delegation comes from the parent's servers, and every
 * failure maps onto the port's result convention instead of throwing.
 */

const dnsError = (code: string) => Object.assign(new Error(code), { code });
const PRIVATE = /^(10\.|192\.168\.|::1$)/;
const isPublicAddress = ({ address }: { address: string }) => !PRIVATE.test(address);

/** Per-instance fake: `answers[server][method:name]` is a value, or an Error to reject with. */
function fakeFactory(answers: Record<string, Record<string, unknown>>) {
  const created: Array<{ options: { timeout: number; tries: number }; servers: string[] }> = [];
  const factory = (options: { timeout: number; tries: number }): DnsResolverLike => {
    const state = { options, servers: ['system'] };
    created.push(state);
    const answer = (method: string) => async (name: string, ...rest: unknown[]) => {
      if (method === 'resolve4' || method === 'resolve6') expect(rest.length === 0 || (rest[0] as { ttl: boolean }).ttl === true).toBe(true);
      const value = answers[state.servers.join(',')]?.[`${method}:${name}`];
      if (value instanceof Error) throw value;
      if (value === undefined) throw dnsError('ENODATA');
      return value;
    };
    return {
      setServers: (servers: readonly string[]) => { state.servers = [...servers]; },
      resolve4: answer('resolve4'), resolve6: answer('resolve6'), resolveCname: answer('resolveCname'), resolveTxt: answer('resolveTxt'),
      resolveMx: answer('resolveMx'), resolveCaa: answer('resolveCaa'), resolveNs: answer('resolveNs'), resolveSrv: answer('resolveSrv'),
    } as unknown as DnsResolverLike;
  };
  return { created, factory };
}

const NS_ADDRESS = { 'resolve4:ns1.dns.test': ['203.0.113.53'], 'resolve6:ns1.dns.test': ['2001:db8::53'] };

describe('query: records from the nameserver itself', () => {
  test('each record type is asked of the nameserver\'s public address and rendered in presentation format', async () => {
    const { created, factory } = fakeFactory({
      system: NS_ADDRESS,
      '203.0.113.53': {
        'resolve4:example.com': [{ address: '203.0.113.10', ttl: 600 }, { address: '203.0.113.11', ttl: 300 }],
        'resolve6:example.com': [{ address: '2001:db8::10', ttl: 120 }],
        'resolveCname:www.example.com': ['target.host.test'],
        'resolveTxt:example.com': [['v=spf1 ', 'include:"x" ~all'], ['plain']],
        'resolveMx:example.com': [{ priority: 10, exchange: 'mx.example.com' }],
        'resolveCaa:example.com': [{ critical: 0, issue: 'letsencrypt.org' }, { critical: 128, issuewild: ';' }, { critical: 0, iodef: 'mailto:a@example.com' }, { critical: 0, contactemail: 'a@example.com' }],
        'resolveNs:example.com': ['ns1.dns.test'],
        'resolveSrv:_sip._tcp.example.com': [{ priority: 1, weight: 5, port: 5060, name: 'sip.example.com' }],
      },
    });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory });
    const ask = (name: string, type: Parameters<typeof port.query>[0]['type']) => port.query({ name, type, nameserver: 'ns1.dns.test' });
    expect(await ask('example.com', 'A')).toEqual({ status: 'ok', value: { answers: ['203.0.113.10', '203.0.113.11'], ttl: 300 } });
    expect(await ask('example.com', 'AAAA')).toEqual({ status: 'ok', value: { answers: ['2001:db8::10'], ttl: 120 } });
    expect(await ask('www.example.com', 'CNAME')).toEqual({ status: 'ok', value: { answers: ['target.host.test'] } });
    expect(await ask('example.com', 'TXT')).toEqual({ status: 'ok', value: { answers: ['"v=spf1 " "include:\\"x\\" ~all"', '"plain"'] } });
    expect(await ask('example.com', 'MX')).toEqual({ status: 'ok', value: { answers: ['10 mx.example.com'] } });
    expect(await ask('example.com', 'CAA')).toEqual({ status: 'ok', value: { answers: ['0 issue "letsencrypt.org"', '128 issuewild ";"', '0 iodef "mailto:a@example.com"'] } });
    expect(await ask('nocaa.example.com', 'CAA')).toEqual({ status: 'ok', value: { answers: [] } });
    expect(await ask('example.com', 'NS')).toEqual({ status: 'ok', value: { answers: ['ns1.dns.test'] } });
    expect(await ask('_sip._tcp.example.com', 'SRV')).toEqual({ status: 'ok', value: { answers: ['1 5 5060 sip.example.com'] } });
    expect(created[0]?.options).toEqual({ timeout: AUTHORITATIVE_DNS_TIMEOUT_MS, tries: 1 });
    expect(created.slice(1).every(entry => entry.servers.join() === '203.0.113.53')).toBe(true);
  });

  test('NODATA is empty, NXDOMAIN is not_found, a timeout or other failure is unknown — never a throw', async () => {
    const { factory } = fakeFactory({
      system: NS_ADDRESS,
      '203.0.113.53': { 'resolve4:gone.example.com': dnsError('ENOTFOUND'), 'resolve4:slow.example.com': dnsError('ETIMEOUT'), 'resolve4:broken.example.com': dnsError('ESERVFAIL'), 'resolve4:weird.example.com': null, 'resolve4:bare.example.com': [] },
    });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory });
    const ask = (name: string) => port.query({ name, type: 'A', nameserver: 'ns1.dns.test' });
    expect(await ask('empty.example.com')).toEqual({ status: 'ok', value: { answers: [] } });
    expect(await ask('gone.example.com')).toEqual({ status: 'rejected', error: { code: 'not_found', message: 'The name does not exist.' } });
    expect(await ask('slow.example.com')).toEqual({ status: 'unknown', error: { code: 'timeout', message: 'The DNS server did not answer in time.' } });
    expect(await ask('broken.example.com')).toEqual({ status: 'unknown', error: { code: 'network', message: 'The DNS query failed before an answer arrived.' } });
    expect((await ask('weird.example.com')).status).toBe('unknown');
    expect(await ask('bare.example.com')).toEqual({ status: 'ok', value: { answers: [] } });
  });

  test('a nameserver the host policy rejects is refused before any record query; ALIAS is not a wire type', async () => {
    const { created, factory } = fakeFactory({ system: { 'resolve4:internal.dns.test': ['10.0.0.53'], 'resolve6:internal.dns.test': ['::1'] } });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory });
    expect(await port.query({ name: 'example.com', type: 'A', nameserver: 'internal.dns.test' })).toEqual({ status: 'unknown', error: { code: 'network', message: 'The nameserver internal.dns.test has no public address.' } });
    expect(await port.query({ name: 'example.com', type: 'A', nameserver: '192.168.1.1' })).toEqual({ status: 'unknown', error: { code: 'network', message: 'The nameserver 192.168.1.1 has no public address.' } });
    expect(created).toHaveLength(1);
    expect(await port.query({ name: 'example.com', type: 'ALIAS', nameserver: 'ns1.dns.test' })).toEqual({ status: 'rejected', error: { code: 'unsupported', message: 'ALIAS is a DNS-host feature, not a record type a nameserver serves.' } });
  });

  test('a public address literal is used as given, and an IPv4 lookup failure still answers over IPv6', async () => {
    const { factory } = fakeFactory({
      system: { 'resolve6:v6.dns.test': ['2001:db8::53'], 'resolve4:v6.dns.test': dnsError('ETIMEOUT') },
      '198.51.100.53': { 'resolveNs:example.com': ['a.test'] },
      '2001:db8::53': { 'resolveNs:example.com': ['b.test'] },
    });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory });
    expect(await port.query({ name: 'example.com', type: 'NS', nameserver: '198.51.100.53' })).toEqual({ status: 'ok', value: { answers: ['a.test'] } });
    expect(await port.query({ name: 'example.com', type: 'NS', nameserver: 'v6.dns.test' })).toEqual({ status: 'ok', value: { answers: ['b.test'] } });
  });
});

describe('queryNs: the delegation the PARENT publishes (review 13-dns #5)', () => {
  const PARENT = { 'resolveNs:example.test': ['ns1.parent.test', 'ns2.parent.test'], 'resolve4:ns1.parent.test': ['203.0.113.1'], 'resolve4:ns2.parent.test': ['203.0.113.2'] };

  /** Replies per parent address; the reply echoes the query id unless `id` is given. */
  function fakeExchange(replies: Record<string, ((id: number) => Uint8Array) | Error>): DnsExchange & { asked: string[] } {
    const asked: string[] = [];
    const exchange = async ({ address, message, timeoutMs }: Parameters<DnsExchange>[0]) => {
      asked.push(`${address}/${timeoutMs}`);
      const reply = replies[address];
      if (reply === undefined || reply instanceof Error) throw reply ?? new Error('unreachable');
      return reply(((message[0] as number) << 8) | (message[1] as number));
    };
    return Object.assign(exchange, { asked });
  }

  test('reads the referral from a parent server, not the child\'s own (stale or cached) NS set', async () => {
    const { factory } = fakeFactory({ '9.9.9.9': { ...PARENT, 'resolveNs:dev.example.test': ['ns.previous-host.test'] } });
    const exchange = fakeExchange({ '203.0.113.1': id => dnsReply({ id, question: 'dev.example.test', authority: [nsRecord('dev.example.test', 'ns1.new.test'), nsRecord('dev.example.test', 'ns2.new.test')] }) });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, bootstrapServers: ['9.9.9.9'], timeoutMs: 1234, exchange, randomId: () => 0xbeef });
    expect(await port.queryNs({ zone: 'Dev.Example.Test.' })).toEqual({ status: 'ok', value: ['ns1.new.test', 'ns2.new.test'] });
    expect(exchange.asked).toEqual(['203.0.113.1/1234']);
  });

  test('a name the parent serves itself (no zone cut) is NODATA; NXDOMAIN is not_found', async () => {
    const { factory } = fakeFactory({ system: PARENT });
    const nodata = fakeExchange({ '203.0.113.1': id => dnsReply({ id, question: 'www.example.test' }) });
    expect(await createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange: nodata }).queryNs({ zone: 'www.example.test' })).toEqual({ status: 'ok', value: [] });
    const nx = fakeExchange({ '203.0.113.1': id => dnsReply({ id, rcode: 3 }) });
    expect(await createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange: nx }).queryNs({ zone: 'gone.example.test' })).toMatchObject({ status: 'rejected', error: { code: 'not_found' } });
  });

  test.each([
    ['a REFUSED rcode', (id: number) => dnsReply({ id, rcode: 5 })],
    ['a mismatched id', (id: number) => dnsReply({ id: id ^ 1, authority: [nsRecord('dev.example.test', 'ns.spoofed.test')] })],
    ['a truncated reply', (id: number) => dnsReply({ id, truncated: true })],
    ['a malformed reply', () => Uint8Array.from([1])],
    ['a transport error', new Error('timeout')],
  ] as const)('%s from the first parent server falls through to the next one', async (_label, first) => {
    const { factory } = fakeFactory({ system: PARENT });
    const exchange = fakeExchange({ '203.0.113.1': first, '203.0.113.2': id => dnsReply({ id, authority: [nsRecord('dev.example.test', 'ns.new.test')] }) });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange });
    expect(await port.queryNs({ zone: 'dev.example.test' })).toEqual({ status: 'ok', value: ['ns.new.test'] });
  });

  test('unknown when no parent server gives a usable answer or has a public address', async () => {
    const { factory } = fakeFactory({ system: { ...PARENT, 'resolve4:ns2.parent.test': ['10.0.0.2'] } });
    const exchange = fakeExchange({ '203.0.113.1': new Error('timeout') });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange });
    expect(await port.queryNs({ zone: 'dev.example.test' })).toEqual({ status: 'unknown', error: { code: 'network', message: 'No nameserver of example.test answered for the delegation of dev.example.test.' } });
    expect(exchange.asked).toEqual([`203.0.113.1/${AUTHORITATIVE_DNS_TIMEOUT_MS}`]);
  });

  test('walks up past names that are not zone cuts to the closest enclosing zone', async () => {
    const { factory } = fakeFactory({ system: PARENT });
    const exchange = fakeExchange({ '203.0.113.1': id => dnsReply({ id, authority: [nsRecord('a.b.example.test', 'ns.a.test')] }) });
    expect(await createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange }).queryNs({ zone: 'a.b.example.test' })).toEqual({ status: 'ok', value: ['ns.a.test'] });
  });

  test('the parent server list failing is reported as is; none anywhere is unknown', async () => {
    const { factory } = fakeFactory({ system: { 'resolveNs:example.test': dnsError('ETIMEOUT'), 'resolveNs:gone.test': dnsError('ENOTFOUND') } });
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange: fakeExchange({}) });
    expect(await port.queryNs({ zone: 'dev.example.test' })).toMatchObject({ status: 'unknown', error: { code: 'timeout' } });
    expect(await port.queryNs({ zone: 'x.gone.test' })).toMatchObject({ status: 'rejected', error: { code: 'not_found' } });
    expect(await port.queryNs({ zone: 'x.nothing.test' })).toEqual({ status: 'unknown', error: { code: 'network', message: 'No zone enclosing nothing.test has nameservers.' } });
  });

  test('a top-level zone has no parent below the root and is read recursively', async () => {
    const { factory } = fakeFactory({ system: { 'resolveNs:test': ['a.nic.test'] } });
    expect(await createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory }).queryNs({ zone: 'test.' })).toEqual({ status: 'ok', value: ['a.nic.test'] });
  });

  test('the default id source is a 16-bit random number the reply must echo', async () => {
    const { factory } = fakeFactory({ system: PARENT });
    const ids: number[] = [];
    const exchange = fakeExchange({ '203.0.113.1': id => { ids.push(id); return dnsReply({ id, authority: [nsRecord('dev.example.test', 'ns.new.test')] }); } });
    expect(await createNodeAuthoritativeDnsResolver({ isPublicAddress }, { createResolver: factory, exchange }).queryNs({ zone: 'dev.example.test' })).toEqual({ status: 'ok', value: ['ns.new.test'] });
    expect(ids[0]).toBeGreaterThanOrEqual(0);
    expect(ids[0]).toBeLessThan(0x10000);
  });

  test('the defaults build a real node:dns Resolver and UDP exchange without sending anything', () => {
    const port = createNodeAuthoritativeDnsResolver({ isPublicAddress });
    expect(typeof port.query).toBe('function');
    expect(typeof port.queryNs).toBe('function');
  });
});
