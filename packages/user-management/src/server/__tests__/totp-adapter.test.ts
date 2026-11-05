import { expect, test } from 'vitest';
import { createOtplibTotp } from '../mfa/totp-adapter.js';

test('RFC 6238 SHA-1 vector truncated to six digits, adjacent step and expiry', async () => {
  const totp = createOtplibTotp({});
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  expect(await totp.verify({secret,code:'287082',nowMs:59000})).toBe(1);
  expect(await totp.verify({secret,code:'287082',nowMs:61000})).toBe(1);
  expect(await totp.verify({secret,code:'287082',nowMs:300000})).toBeNull();
  for (const code of ['12345','1234567','abcdef',' 287082']) expect(await totp.verify({secret,code,nowMs:59000})).toBeNull();
  const generated = totp.generate(); expect(generated.length).toBeGreaterThanOrEqual(32);
  expect(totp.uri({secret:generated,label:'owner@example.test',issuer:'Neutral'})).toContain('otpauth://totp/');
});
