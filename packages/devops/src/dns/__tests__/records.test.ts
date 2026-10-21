import { describe, expect, test } from 'vitest';
import { chunkTxt, TXT_CHUNK_BYTES } from '../contract.js';
import { buildRecord, canonicalIpv6, dnsValueKey, isMxValue, normalizeDnsName, parseAnswerValue, parseCaaText, parseMxText, requirementValue, sameValueSet, unquoteTxt } from '../records.js';
import { isSpfValue, mergeSpf, spfSatisfies } from '../spf.js';

describe('chunkTxt', () => {
  test('keeps a short value as one chunk and an empty value as one empty chunk', () => {
    expect(chunkTxt({ value: 'v=DKIM1; p=abc' })).toEqual(['v=DKIM1; p=abc']);
    expect(chunkTxt({ value: '' })).toEqual(['']);
  });
  test('splits at 255 bytes and never inside a multi-byte character', () => {
    const ascii = 'a'.repeat(600);
    expect(chunkTxt({ value: ascii }).map(chunk => chunk.length)).toEqual([255, 255, 90]);
    const value = `${'a'.repeat(254)}é${'b'.repeat(3)}`;
    const chunks = chunkTxt({ value });
    expect(chunks).toEqual(['a'.repeat(254), `é${'bbb'}`]);
    for (const chunk of chunkTxt({ value: '€'.repeat(200) })) expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(TXT_CHUNK_BYTES);
    expect(chunkTxt({ value: '€'.repeat(200) }).join('')).toBe('€'.repeat(200));
  });
});

// Regression (review 13-dns #9): equivalent IPv6 spellings compared unequal, so a satisfied AAAA
// record was planned as an update and never verified as propagated.
describe('IPv6 canonical form (RFC 5952)', () => {
  test.each([
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
    ['::', '::'],
    ['::1', '::1'],
    ['1::', '1::'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    ['::ffff:192.0.2.1', '::ffff:c000:201'],
  ])('%s -> %s', (address, canonical) => {
    expect(canonicalIpv6({ address })).toBe(canonical);
  });
  test.each(['1:2:3', '1::2::3', 'g::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8::', '::1.2.3.256', '::1.2.3', '12345::', '192.0.2.1', ''])('rejects %j', address => {
    expect(canonicalIpv6({ address })).toBeUndefined();
  });
  test('AAAA answers and requirements compare in canonical form; invalid text is only lowercased', () => {
    expect(parseAnswerValue({ type: 'AAAA', text: '2001:DB8:0:0:0:0:0:1' })).toBe('2001:db8::1');
    expect(requirementValue({ record: { type: 'AAAA', name: 'x.test', value: '2001:db8:0000::0001' } })).toBe('2001:db8::1');
    expect(sameValueSet({ left: [parseAnswerValue({ type: 'AAAA', text: '2001:db8::1' }) as string], right: [parseAnswerValue({ type: 'AAAA', text: '2001:0db8:0:0::1' }) as string] })).toBe(true);
    expect(parseAnswerValue({ type: 'AAAA', text: ' Not-An-Address ' })).toBe('not-an-address');
  });
});

describe('isMxValue', () => {
  test('takes the value in a required object', () => {
    expect(isMxValue({ value: { priority: 10, exchange: 'mx.test' } })).toBe(true);
    expect(isMxValue({ value: 'mx.test' })).toBe(false);
    expect(isMxValue({ value: { flags: 0, tag: 'issue', value: 'ca.test' } }, {})).toBe(false);
  });
});

describe('value parsing', () => {
  test('normalizes names', () => {
    expect(normalizeDnsName({ name: ' WWW.Example.COM. ' })).toBe('www.example.com');
  });
  test('parses MX and CAA presentation text and rejects malformed text', () => {
    expect(parseMxText({ text: '10 MX1.Example.com.' })).toEqual({ priority: 10, exchange: 'mx1.example.com' });
    expect(parseMxText({ text: 'mx1.example.com' })).toBeUndefined();
    expect(parseCaaText({ text: '0 ISSUE "letsencrypt.org"' })).toEqual({ flags: 0, tag: 'issue', value: 'letsencrypt.org' });
    expect(parseCaaText({ text: '128 iodef mailto:sec@example.com' })).toEqual({ flags: 128, tag: 'iodef', value: 'mailto:sec@example.com' });
    expect(parseCaaText({ text: '0 tbs "x"' })).toBeUndefined();
  });
  test('joins quoted TXT character-strings, unescaping, and keeps unquoted text', () => {
    expect(unquoteTxt({ text: '"v=spf1 " "include:a.test \\"q\\" -all"' })).toBe('v=spf1 include:a.test "q" -all');
    expect(unquoteTxt({ text: 'plain value' })).toBe('plain value');
  });
  test('parses answers by type: host names normalized, addresses lowercased', () => {
    expect(parseAnswerValue({ type: 'CNAME', text: 'Target.Host.' })).toBe('target.host');
    expect(parseAnswerValue({ type: 'AAAA', text: ' 2001:DB8::1 ' })).toBe('2001:db8::1');
    expect(parseAnswerValue({ type: 'TXT', text: '"a" "b"' })).toBe('ab');
    expect(parseAnswerValue({ type: 'MX', text: '5 mx.test.' })).toEqual({ priority: 5, exchange: 'mx.test' });
    expect(parseAnswerValue({ type: 'CAA', text: '0 issue "ca.test"' })).toEqual({ flags: 0, tag: 'issue', value: 'ca.test' });
  });
  test('requirement values default the MX priority and reject a malformed CAA', () => {
    expect(requirementValue({ record: { type: 'MX', name: 'x.test', value: 'MX.test.' } })).toEqual({ priority: 10, exchange: 'mx.test' });
    expect(requirementValue({ record: { type: 'MX', name: 'x.test', value: 'mx.test', priority: 20 } })).toEqual({ priority: 20, exchange: 'mx.test' });
    expect(requirementValue({ record: { type: 'CAA', name: 'x.test', value: 'nonsense' } })).toBeUndefined();
    expect(requirementValue({ record: { type: 'A', name: 'x.test', value: '192.0.2.1' } })).toBe('192.0.2.1');
  });
  test('value keys and set comparison are order-insensitive and type-aware', () => {
    expect(dnsValueKey({ value: { priority: 1, exchange: 'mx.test' } })).toBe('1 mx.test');
    expect(dnsValueKey({ value: { flags: 0, tag: 'issue', value: 'ca.test' } })).toBe('0 issue "ca.test"');
    expect(sameValueSet({ left: ['a', 'b'], right: ['b', 'a'] })).toBe(true);
    expect(sameValueSet({ left: ['a'], right: ['a', 'b'] })).toBe(false);
    expect(sameValueSet({ left: ['a', 'c'], right: ['a', 'b'] })).toBe(false);
    expect(buildRecord({ name: 'x.test', type: 'A', ttl: 60, values: ['192.0.2.1'] })).toEqual({ name: 'x.test', type: 'A', ttl: 60, values: ['192.0.2.1'] });
  });
});

describe('SPF', () => {
  test('recognizes SPF values only by the v=spf1 version tag', () => {
    expect(isSpfValue({ value: ' V=SPF1 -all' })).toBe(true);
    expect(isSpfValue({ value: 'v=spf1' })).toBe(true);
    expect(isSpfValue({ value: 'v=spf10 -all' })).toBe(false);
  });
  test('merges mechanisms into the existing record, keeping its all qualifier last', () => {
    expect(mergeSpf({ base: 'v=spf1 include:a.test ~all', addition: 'v=spf1 include:b.test -all' })).toBe('v=spf1 include:a.test include:b.test ~all');
    expect(mergeSpf({ base: 'v=spf1 INCLUDE:a.test', addition: 'v=spf1 include:a.test ip4:192.0.2.1 -all' })).toBe('v=spf1 INCLUDE:a.test ip4:192.0.2.1 -all');
    expect(mergeSpf({ base: 'v=spf1 mx', addition: 'v=spf1 a' })).toBe('v=spf1 mx a');
  });
  test('satisfaction is containment of the wanted mechanisms, ignoring all', () => {
    expect(spfSatisfies({ actual: 'v=spf1 include:a.test include:b.test ~all', wanted: 'v=spf1 include:b.test -all' })).toBe(true);
    expect(spfSatisfies({ actual: 'v=spf1 include:a.test ~all', wanted: 'v=spf1 include:b.test -all' })).toBe(false);
  });
});
