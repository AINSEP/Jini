import { describe, expect, it } from 'vitest';
import { signSigV4, type SignSigV4Input } from '../aws-sigv4.js';

// F1 fix wave (Stryker L1 §4 aws-sigv4.ts: the `?? lowercase` header-value fallback, trimValue
// `\s+` and method upper-casing survived). Vectors are compared against the canonical lower-case
// spelling of the same request, so the expected signature never has to be hard-coded.
const CREDENTIALS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const NOW = new Date('2026-01-15T12:34:56.789Z');
const sign = (overrides: Partial<SignSigV4Input>) => signSigV4({
  method: 'GET', path: '/o', query: '', headers: { host: 'b.s3.amazonaws.com' }, body: Buffer.alloc(0),
  region: 'us-east-1', service: 's3', credentials: CREDENTIALS, now: NOW, ...overrides,
}).authorization;

describe('signSigV4 — F1 canonicalisation', () => {
  it('BUG (fixed in F1): a mixed-case header key is signed with its VALUE, exactly like its lower-case spelling', () => {
    expect(sign({ headers: { Host: 'b.s3.amazonaws.com', 'X-Amz-Meta-Tag': 'v' } })).toBe(sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': 'v' } }));
  });

  it('a different header value yields a different signature (values really are signed)', () => {
    expect(sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': 'v1' } })).not.toBe(sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': 'v2' } }));
  });

  it('header values are trimmed and internal whitespace RUNS collapse to one space', () => {
    const canonical = sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': 'a b c' } });
    expect(sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': '  a   b\t\tc  ' } })).toBe(canonical);
    expect(sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': 'a  b c' } })).toBe(canonical);
    expect(sign({ headers: { host: 'b.s3.amazonaws.com', 'x-amz-meta-tag': 'abc' } })).not.toBe(canonical);
  });

  it('the method is upper-cased before signing', () => {
    expect(sign({ method: 'put' })).toBe(sign({ method: 'PUT' }));
    expect(sign({ method: 'PUT' })).not.toBe(sign({ method: 'GET' }));
  });

  it('SignedHeaders lists every header lower-cased, sorted, once', () => {
    const auth = sign({ headers: { Host: 'b.s3.amazonaws.com', 'X-Amz-Meta-Tag': 'v' } });
    expect(auth).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-meta-tag,');
  });

  it('a session token is added and signed only when present', () => {
    const headers: Record<string, string> = { host: 'b.s3.amazonaws.com' };
    signSigV4({ method: 'GET', path: '/o', query: '', headers, body: Buffer.alloc(0), region: 'r', service: 's3', credentials: { ...CREDENTIALS, sessionToken: 'tok' }, now: NOW });
    expect(headers['x-amz-security-token']).toBe('tok');
    expect(headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,');
    const noToken: Record<string, string> = { host: 'b.s3.amazonaws.com' };
    signSigV4({ method: 'GET', path: '/o', query: '', headers: noToken, body: Buffer.alloc(0), region: 'r', service: 's3', credentials: { ...CREDENTIALS, sessionToken: '' }, now: NOW });
    expect('x-amz-security-token' in noToken).toBe(false);
  });
});
