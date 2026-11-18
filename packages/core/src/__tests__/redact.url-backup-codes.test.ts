import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;

// A backup (recovery, scratch, emergency) code signs a person in once their second factor is lost; in a URL it is as
// much a credential as the one-time and verification codes the name set already masks. It was missing from the set.
describe('backup and recovery codes in URL parameters', () => {
  it.each([
    'backup_code', 'backupCode', 'backup-code', 'backup_codes', 'recovery_codes', 'scratch_code', 'emergency_code',
    'mfa_backup_code', 'mfa_recovery_codes', 'otp_codes',
  ])('masks the %s value', name => {
    for (const prefix of ['https://example.com/verify?user=1&', 'https://example.com/verify#']) {
      expect(run(`${prefix}${name}=48213977`)).not.toContain('48213977');
    }
  });

  it.each(['zipcode', 'promo_code', 'error_code', 'backup', 'backup_date', 'country_codes'])('keeps the public %s value', name => {
    expect(run(`https://example.com/x?${name}=48213977`)).toBe(`https://example.com/x?${name}=48213977`);
  });
});
