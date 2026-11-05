import { generateSecret, generateURI, verify } from 'otplib';
import type { TotpPort } from './ports.js';

/** RFC 6238 via otplib, SHA-1/six digits/30 seconds; one adjacent step allowed for clock drift.
 * @complexity O(1): at most three library HMAC verifications; no I/O or retained secrets.
 */
export function createOtplibTotp(_required: Record<string, never>, _options: Record<string, never> = {}): TotpPort {
  return {
    generate: () => generateSecret(),
    uri: input => generateURI({ ...input, algorithm: 'sha1', digits: 6, period: 30 }),
    async verify(input) {
      if (!/^\d{6}$/.test(input.code)) return null;
      const result = await verify({ secret: input.secret, token: input.code, epoch: Math.floor(input.nowMs / 1000),
        algorithm: 'sha1', digits: 6, period: 30, epochTolerance: 30 });
      return result.valid && 'timeStep' in result ? result.timeStep : null;
    },
  };
}
