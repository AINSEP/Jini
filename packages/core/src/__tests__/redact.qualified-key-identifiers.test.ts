import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;

// `Sort key: name` keeps its value, but only up to 11 characters; a readable column name of any length
// (`customerLastName`) was masked, unlike the formatter chat used before, which kept both.
describe('qualified key answers that are readable identifiers', () => {
  it.each([
    '- Sort key: customerLastName',
    'Primary key: orderPlacedAtTimestamp',
    'Partition key: tenant_id_shard_bucket',
    'Sort key: created_at',
    'Sort key: id',
  ])('keeps %j', input => {
    expect(run(input)).toBe(input);
  });

  it.each(['Sort key: abcdefgh1234567890', 'Sort key: Zq8wPx3mK7vR2tL9', 'Sort key: a8f3k2m9x7q1z5w4'])('masks the random value in %j', input => {
    expect(run(input)).toBe('Sort key: [REDACTED:labeled_secret]');
  });
});
