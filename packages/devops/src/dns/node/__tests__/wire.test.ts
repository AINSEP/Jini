import { describe, expect, test } from 'vitest';
import { decodeNsReply, encodeNsQuery } from '../wire.js';
import { DNS_NAME, dnsReply, nsRecord } from './wire-fixtures.js';

describe('encodeNsQuery', () => {
  test('a non-recursive IN NS question with the id in the header', () => {
    expect([...encodeNsQuery({ id: 0x1234, name: 'Dev.example.test.' })]).toEqual([0x12, 0x34, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...DNS_NAME('Dev.example.test'), 0, 2, 0, 1]);
    expect([...encodeNsQuery({ id: 0x1_0001, name: 'a' }).slice(0, 2)]).toEqual([0, 1]);
  });
  test('refuses a label longer than 63 bytes', () => {
    expect(() => encodeNsQuery({ id: 1, name: `${'a'.repeat(64)}.test` })).toThrow(RangeError);
  });
});

describe('decodeNsReply', () => {
  test('reads a referral from the authority section, skipping other owners and types', () => {
    const message = dnsReply({ id: 7, question: 'dev.example.test', authority: [
      nsRecord('DEV.example.test', 'NS1.new.test'), nsRecord('dev.example.test', 'ns2.new.test'), nsRecord('dev.example.test', 'ns1.new.test'),
      nsRecord('other.example.test', 'ns.other.test'), { owner: DNS_NAME('dev.example.test'), type: 6, rdata: [1, 2, 3] },
    ] });
    expect(decodeNsReply({ message, name: 'dev.example.test.' })).toEqual({ id: 7, rcode: 0, truncated: false, nameservers: ['ns1.new.test', 'ns2.new.test'] });
  });

  test('follows compression pointers in owners and targets; reads the answer section too', () => {
    // Offset 12 is the question name; the target points into it after a literal first label.
    const message = dnsReply({ id: 9, question: 'dev.example.test', answers: [nsRecord([0xc0, 12], [3, ...new TextEncoder().encode('ns1'), 0xc0, 12])] });
    expect(decodeNsReply({ message, name: 'dev.example.test' }).nameservers).toEqual(['ns1.dev.example.test']);
  });

  test('reports rcode and the truncation bit', () => {
    expect(decodeNsReply({ message: dnsReply({ id: 1, rcode: 3, truncated: true }), name: 'x.test' })).toEqual({ id: 1, rcode: 3, truncated: true, nameservers: [] });
  });

  test.each([
    ['a short header', Uint8Array.from([0, 1, 0])],
    ['a question name running off the end', Uint8Array.from([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 5, 97])],
    ['a reserved label type', Uint8Array.from([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x40, 0])],
    ['a compression loop', Uint8Array.from([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0xc0, 12])],
    ['a missing terminator', Uint8Array.from([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 97])],
    ['rdata past the end', Uint8Array.from([...dnsReply({ id: 1, answers: [nsRecord('x.test', 'ns.test')] }).slice(0, -2)])],
  ])('throws on %s', (_label, message) => {
    expect(() => decodeNsReply({ message, name: 'x.test' })).toThrow(RangeError);
  });
});
