import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// Before the "zipcode" fix, any name ending in `code` was masked, which also covered activation and
// verification codes. Those are single-use credentials (account activation, password reset, sign-in), so
// they stay masked; the fix matched the NAME SET, not any name that ends in `code`.
describe('URL parameters that carry a one-time or activation code', () => {
  it.each([
    'activation_code', 'confirmation_code', 'verification_code', 'verify_code', 'reset_code', 'recovery_code', 'auth_code', 'authorization_code',
    'login_code', 'signin_code', 'session_code', 'device_code', 'security_code', 'access_code', 'invite_code', 'invitation_code', 'magic_code',
    'otp_code', 'otp', 'totp', 'mfa_code', 'two_factor_code', 'sms_code', 'pairing_code', 'oauth_code', 'activationCode', 'verificationCode',
    'activation-code', 'one_time_code', 'code', 'code_verifier',
  ])('masks the value of %s in a query and a fragment', name => {
    expect(run(`https://x.test/a?${name}=123456&page=2`).redacted).toBe(`https://x.test/a?${name}=[REDACTED:url_secret_param]&page=2`);
    expect(run(`https://x.test/a#${name}=123456`).redacted).toBe(`https://x.test/a#${name}=[REDACTED:url_secret_param]`);
  });
  it('masks a code parameter that follows another one', () => {
    expect(run('https://x.test/a?user=7&activation_code=AB12CD&verification_code=998877').redacted)
      .toBe('https://x.test/a?user=7&activation_code=[REDACTED:url_secret_param]&verification_code=[REDACTED:url_secret_param]');
  });
  it.each([
    'zipcode', 'postcode', 'postal_code', 'promo_code', 'discount_code', 'coupon_code', 'error_code', 'status_code', 'country_code', 'language_code',
    'color_code', 'area_code', 'currency_code', 'barcode', 'unicode', 'encode', 'code_challenge', 'code_challenge_method', 'codec',
  ])('keeps the value of the unrelated name %s', name => {
    const input = `https://x.test/a?${name}=90210&page=2`;
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});
