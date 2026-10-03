import { describe, expect, it } from 'vitest';
import { redactSecrets } from '@jini-ai/core';
import { sanitizeUntrustedText } from '@jini-ai/core/text';
import { sanitizeUnknownDeep } from '../redact.js';

describe('canonical redaction migration', () => {
  // PARITY: pin the core union's explicitly selected aggressive policy for former direct CLI users.
  it('labels credentials, opaque runs and PII instead of the retired lowercase marker', () => {
    expect(redactSecrets({ input: 'password=short alice@example.com 192.0.2.1 ' + 'A'.repeat(32) }, { policy: 'aggressive' }))
      .toBe('password=[REDACTED:labeled_secret] [REDACTED:email] [REDACTED:ipv4] [REDACTED:opaque_token]');
  });
  // PARITY: terminal transport boundaries keep the frozen lowercase sanitizer contract.
  // The frozen CLI rule replaces the whole whitespace-free `password=short` match.
  it('keeps bounded text and recursive JSON output byte-identical', () => {
    expect(sanitizeUntrustedText({ text: 'password=short alice@example.com 192.0.2.1' }))
      .toBe('[redacted] alice@example.com 192.0.2.1');
    expect(sanitizeUnknownDeep({ value: { secret: 'A'.repeat(32) } })).toEqual({ secret: '[redacted]' });
  });
  // PARITY: diagnostics retain conservative defaults; identifiers are not bare secrets.
  it('leaves common identifiers and paths readable under the default policy', () => {
    for (const input of ['550e8400-e29b-41d4-a716-446655440000', 'a'.repeat(40),
      'claude-sonnet-4-5-20250929', '/var/cache/delegated-tool-calls/log.json', 'ERR-AAAA-1111-BBBB-2222']) {
      expect(redactSecrets({ input })).toBe(input);
    }
  });
});
