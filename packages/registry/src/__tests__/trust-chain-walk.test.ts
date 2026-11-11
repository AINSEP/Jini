import type { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { certIssuedAndSignedBy, chainToTrustedRoot, parseSanUris } from '../trust-certificates.js';

/** L2 §8.2: deterministic fake certificates (DN link + signature key are independent switches) so
 *  each rejection — empty, broken link, cycle, DN-only match, over-long walk — is its own case. */
let calls = 0;
function cert(name: string, issuer: string, { signedWith = issuer }: { signedWith?: string } = {}) {
  return {
    name,
    publicKey: `key:${name}`,
    checkIssued(candidate: { name: string }) { calls += 1; return candidate.name === issuer; },
    verify(key: string) { return key === `key:${signedWith}`; },
  } as unknown as X509Certificate;
}
const ca = cert('CA', 'CA');

describe('chainToTrustedRoot', () => {
  it('empty chain is never trusted', () => {
    expect(chainToTrustedRoot([], [ca])).toBe(false);
  });
  it('a leaf directly signed by a trusted CA is trusted; with no CAs it is not', () => {
    expect(chainToTrustedRoot([cert('L', 'CA')], [ca])).toBe(true);
    expect(chainToTrustedRoot([cert('L', 'CA')], [])).toBe(false);
  });
  it('walks intermediates in any bundle order, using up to chain.length hops', () => {
    const chain = [cert('L', 'I1'), cert('I3', 'CA'), cert('I1', 'I2'), cert('I2', 'I3')];
    expect(chainToTrustedRoot(chain, [ca])).toBe(true);
  });
  it('a missing intermediate breaks the chain', () => {
    expect(chainToTrustedRoot([cert('L', 'I1'), cert('I2', 'CA')], [ca])).toBe(false);
  });
  it('a DN match without a valid signature is refused at the CA and at an intermediate', () => {
    expect(chainToTrustedRoot([cert('L', 'CA', { signedWith: 'EVIL' })], [ca])).toBe(false);
    expect(chainToTrustedRoot([cert('L', 'I1', { signedWith: 'EVIL' }), cert('I1', 'CA')], [ca])).toBe(false);
  });
  it('a cyclic bundle terminates quickly and is refused', () => {
    calls = 0;
    expect(chainToTrustedRoot([cert('L', 'A'), cert('A', 'B'), cert('B', 'A')], [ca])).toBe(false);
    expect(calls).toBeLessThanOrEqual(8);
  });
  it('trusts when ANY configured CA signed the top, not only the first', () => {
    expect(chainToTrustedRoot([cert('L', 'CA2')], [ca, cert('CA2', 'CA2')])).toBe(true);
  });
});

describe('certIssuedAndSignedBy', () => {
  it('requires both DN linkage and signature, and swallows a throwing verify as false', () => {
    expect(certIssuedAndSignedBy(cert('L', 'CA'), ca)).toBe(true);
    expect(certIssuedAndSignedBy(cert('L', 'X', { signedWith: 'CA' }), ca)).toBe(false);
    const throwing = { checkIssued: () => true, verify: () => { throw new TypeError('bad key'); } };
    expect(certIssuedAndSignedBy(throwing, ca)).toBe(false);
  });
});

describe('parseSanUris', () => {
  it.each([
    [null, []], [undefined, []], ['', []],
    ['URI:https://a, DNS:b, URI:https://c', ['https://a', 'https://c']],
    [' URI:https://x ', ['https://x']],
    ['DNS:URI:evil, email:URI:x', []],
  ])('%j → %j', (input, expected) => {
    expect(parseSanUris(input)).toEqual(expected);
  });
});
