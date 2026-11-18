import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });
const tail = (length: number) => 'aB3xK9'.repeat(Math.ceil(length / 6)).slice(0, length);

// Vendor key shapes the diagnostics rules masked at lengths and prefixes the shared catalog's
// exact-length entries miss. Every value here is obviously fake.
describe('payment-provider webhook signing secrets', () => {
  it.each([24, 32, 40, 100])('masks a whsec_ value with %i characters after the prefix', length => {
    expect(run(`key whsec_${tail(length)} end`)).toEqual({ redacted: 'key [REDACTED:stripe_key] end', counts: { stripe_key: 1 } });
  });
  it.each(['whsec_abc', `whsec_${tail(23)}`, `xwhsec_${tail(30)}`, `my_whsec_${tail(30)}`])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});

describe('GitHub tokens shorter than the catalog length', () => {
  it.each(['ghp', 'gho', 'ghs', 'ghu', 'ghr'].flatMap(kind => [30, 35, 36, 40].map(length => [kind, length] as const)))(
    'masks %s_ with %i characters', (kind, length) => {
      expect(run(`t ${kind}_${tail(length)} end`)).toEqual({ redacted: 't [REDACTED:github_token] end', counts: { github_token: 1 } });
    });
  it.each([`ghs_${tail(29)}`, `xghs_${tail(40)}`, 'ghx_' + tail(40)])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});

describe('temporary AWS access key ids', () => {
  it('masks ASIA plus 16 capitals and digits', () => {
    expect(run('id ASIAABCDEFGHIJKLMNOP end')).toEqual({ redacted: 'id [REDACTED:aws_access_key] end', counts: { aws_access_key: 1 } });
  });
  // Changed by redact.vendor-boundaries.test.ts: a key id glued to a lowercase word or `_` is masked, as the AKIA one is.
  it.each(['ASIAABCDEFGHIJKLMNOPQ', 'ASIAABCDEFGHIJKLMNO', 'asiaabcdefghijklmnop'])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});

describe('second pass', () => {
  it.each([`whsec_${tail(30)}`, `ghs_${tail(30)}`, 'ASIAABCDEFGHIJKLMNOP'])('keeps the marker for %j', input => {
    const once = run(input).redacted;
    expect(run(once)).toEqual({ redacted: once, counts: {} });
  });
});
