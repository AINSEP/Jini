import { describe, expect, it } from 'vitest';
import { formatUserFacingError } from './user-facing-error.js';

const input = { message: 'The export stopped while building the ZIP.', action: 'Copy details and report this problem.', step: 'archive', cause: 'ZIP writer failed' };
const metadata = { errorId: 'ERR-1234-5678-9ABC-DEF0', appVersion: '1.2.3', jiniVersion: '0.6.21', time: '2026-11-04T12:00:00Z' };

describe('formatUserFacingError', () => {
  it('returns deterministic, pasteable diagnostics without changing its input', () => {
    const required = Object.freeze({ ...input });
    const result = formatUserFacingError(required, Object.freeze(metadata));
    expect(result).toMatchObject({ ...input, ...metadata });
    expect(result.copyText).toBe([
      `Message: ${input.message}`, `Next action: ${input.action}`, `Error ID: ${metadata.errorId}`,
      'Step: archive', 'Cause: ZIP writer failed', 'App version: 1.2.3', 'Jini version: 0.6.21', `Time: ${metadata.time}`,
    ].join('\n'));
    expect(formatUserFacingError(required, metadata)).toEqual(result);
  });

  it('reuses an existing tool error ID when the boundary did not supply one', () => {
    const result = formatUserFacingError({ ...input, cause: `Failed (${metadata.errorId})` });
    expect(result.errorId).toBe(metadata.errorId);
    expect(result.copyText).toContain(metadata.errorId);
  });

  it('redacts complete input before truncating, including a key crossing the cutoff', () => {
    const secret = 'ghp_' + 'A'.repeat(36);
    const result = formatUserFacingError({ ...input, cause: 'x'.repeat(4079) + ' ' + secret + ' tail'.repeat(100) });
    expect(result.cause.length).toBeLessThanOrEqual(4096);
    expect(result.copyText).not.toContain(secret);
    expect(result.copyText).not.toContain('ghp_A');
    expect(result.cause).toContain('[REDACTED');
  });

  it('redacts every displayed field and exact overlapping secrets without leaking to copying', () => {
    const value = 'credential abcdefgh and bcdefghij';
    const result = formatUserFacingError({ message: value, action: value, step: value, cause: value }, {
      errorId: value, appVersion: value, jiniVersion: value, time: value, exactSecrets: ['abcdefgh', 'bcdefghij'],
    });
    for (const field of Object.values(result)) {
      expect(field).not.toContain('abcdefgh');
      expect(field).not.toContain('bcdefghij');
    }
  });

  it('also redacts exact secrets formed across a copy label and an input field', () => {
    const result = formatUserFacingError({ ...input, message: 'CANARY_LABEL' }, { exactSecrets: ['Message: CANARY_LABEL'] });
    expect(result.copyText).not.toContain('Message: CANARY_LABEL');
  });

  it('bounds the final copy block after redaction markers expand short exact secrets', () => {
    const result = formatUserFacingError({ ...input, message: 'x '.repeat(3000), cause: 'x '.repeat(10000) }, { exactSecrets: ['x'] });
    expect(result.copyText.length).toBeLessThanOrEqual(8192);
  });

  it('handles signed URLs, private keys, circular causes and hostile getters through core redaction', () => {
    const cause: Record<string, unknown> = {
      url: 'https://example.test/export?X-Amz-Signature=CANARY_SIGNATURE',
      key: '-----BEGIN PRIVATE KEY-----\nCANARY_PEM\n-----END PRIVATE KEY-----',
    };
    cause.self = cause;
    const result = formatUserFacingError({ ...input, cause });
    expect(result.copyText).not.toMatch(/CANARY_SIGNATURE|CANARY_PEM/);
    expect(result.cause).toContain('[Circular]');
    const hostile = Object.defineProperty({}, 'secret', { enumerable: true, get() { throw new Error('CANARY_GETTER'); } });
    expect(formatUserFacingError({ ...input, cause: hostile }).cause).toBe('[Unformattable error]');
  });
});
