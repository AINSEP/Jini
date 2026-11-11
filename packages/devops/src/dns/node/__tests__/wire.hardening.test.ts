import { describe, expect, it } from 'vitest';
import { decodeNsReply, encodeNsQuery } from '../wire.js';
import { DNS_NAME, dnsReply, nsRecord, type FixtureRecord } from './wire-fixtures.js';

/** L9 §8.8: label-length boundary (bytes, not chars), compression pointers (target, loop, chained),
 *  truncation, and header flag decoding — each malformed message refused with its exact reason. */
describe('encodeNsQuery', () => {
  it('a 63-byte label encodes; 64 bytes (or 22 three-byte chars) throws the exact RangeError', () => {
    const ok = encodeNsQuery({ id: 1, name: `${'a'.repeat(63)}.test` });
    expect(ok[12]).toBe(63);
    expect(() => encodeNsQuery({ id: 1, name: `${'a'.repeat(64)}.test` })).toThrow(new RangeError(`The DNS label '${'a'.repeat(64)}' is longer than 63 bytes.`));
    expect(() => encodeNsQuery({ id: 1, name: '語'.repeat(22) })).toThrow(RangeError);
  });
  it('masks the id to 16 bits, drops empty labels and ends with QTYPE NS / QCLASS IN', () => {
    const query = encodeNsQuery({ id: 0x1abcd, name: 'a..b.' });
    expect([...query]).toEqual([0xab, 0xcd, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 97, 1, 98, 0, 0, 2, 0, 1]);
  });
});

describe('decodeNsReply hardening', () => {
  const reply = (answers: FixtureRecord[], extra: Partial<Parameters<typeof dnsReply>[0]> = {}) =>
    dnsReply({ id: 7, question: 'example.com', answers, ...extra });

  it('a 63-byte label in a record decodes; a 64-byte label length is a malformed name', () => {
    const long = 'n'.repeat(63);
    expect(decodeNsReply({ message: reply([nsRecord('example.com', `${long}.net`)]), name: 'example.com' }).nameservers).toEqual([`${long}.net`]);
    const bad = reply([nsRecord('example.com', [64, ...new Array(64).fill(110), 0])]);
    expect(() => decodeNsReply({ message: bad, name: 'example.com' })).toThrow(new RangeError('The DNS message has a malformed name.'));
  });

  it('a label running past the end of the message is malformed', () => {
    const message = Uint8Array.from([...reply([]).subarray(0, 12)].map((b, i) => (i === 5 ? 1 : b)).concat([5, 97, 98]));
    expect(() => decodeNsReply({ message, name: 'x' })).toThrow(new RangeError('The DNS message has a malformed name.'));
  });

  it('follows a compression pointer to the question name (offset & 0x3fff) and resumes after it', () => {
    const message = reply([nsRecord([0xc0, 12], 'ns1.example.net'), nsRecord([0xc0, 12], [3, 110, 115, 50, 0xc0, 12])]);
    expect(decodeNsReply({ message, name: 'example.com' }).nameservers).toEqual(['ns1.example.net', 'ns2.example.com']);
  });

  it('a self-referencing pointer is a compression loop, not a hang', () => {
    const base = [...reply([])];
    base[7] = 1; // one answer
    const loop = Uint8Array.from([...base, 0xc0, base.length]);
    expect(() => decodeNsReply({ message: loop, name: 'example.com' })).toThrow(new RangeError('The DNS message has a name compression loop.'));
  });

  it('a pointer past the end of the message is truncated', () => {
    const message = reply([nsRecord([0xc0, 0xff], 'ns1.example.net')]);
    expect(() => decodeNsReply({ message, name: 'example.com' })).toThrow(new RangeError('The DNS message is truncated.'));
  });

  it('rdlength beyond the message and a short header are truncated', () => {
    const full = reply([nsRecord('example.com', 'ns1.example.net')]);
    expect(() => decodeNsReply({ message: full.subarray(0, full.length - 1), name: 'example.com' })).toThrow(new RangeError('The DNS message is truncated.'));
    expect(() => decodeNsReply({ message: Uint8Array.from([0, 1, 0]), name: 'x' })).toThrow(new RangeError('The DNS message is truncated.'));
  });

  it('decodes id, rcode (low 4 bits only) and the TC flag', () => {
    const message = reply([], { rcode: 3, truncated: true });
    message[2] = (message[2] ?? 0) | 0x04; // AA bit must not leak into rcode
    expect(decodeNsReply({ message, name: 'example.com' })).toEqual({ id: 7, rcode: 3, truncated: true, nameservers: [] });
    expect(decodeNsReply({ message: reply([]), name: 'example.com' })).toMatchObject({ rcode: 0, truncated: false });
  });

  it('keeps only NS records owned by the asked name (case/trailing-dot insensitive), from answer AND authority, deduplicated', () => {
    const soa = { owner: DNS_NAME('example.com'), type: 6, rdata: DNS_NAME('ns9.example.net') };
    const message = reply([nsRecord('EXAMPLE.com', 'NS1.example.net'), soa, nsRecord('other.com', 'ns2.example.net')], {
      authority: [nsRecord('example.com', 'ns1.example.net'), nsRecord('example.com', 'ns3.example.net')],
    });
    expect(decodeNsReply({ message, name: 'Example.Com.' }).nameservers).toEqual(['ns1.example.net', 'ns3.example.net']);
  });
});
