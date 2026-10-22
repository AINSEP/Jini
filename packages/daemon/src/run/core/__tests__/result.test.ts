import { describe, expect, it } from 'vitest';
import { deriveRunErrorCode, runResultFromStatus } from '../result.js';

describe('runResultFromStatus', () => {
  it('maps succeeded/canceled to success/cancelled and everything else to failed', () => {
    expect(runResultFromStatus({ status: 'succeeded' })).toBe('success');
    expect(runResultFromStatus({ status: 'canceled' })).toBe('cancelled');
    expect(runResultFromStatus({ status: 'failed' })).toBe('failed');
    expect(runResultFromStatus({ status: 'anything-else' })).toBe('failed');
    expect(runResultFromStatus({ status: undefined })).toBe('failed');
  });
});

describe('deriveRunErrorCode', () => {
  it('returns undefined for a successful run', () => {
    expect(deriveRunErrorCode({ status: { status: 'succeeded', errorCode: 'IGNORED' } })).toBeUndefined();
  });

  it('forwards only an explicit error code for a cancelled run', () => {
    expect(deriveRunErrorCode({ status: { status: 'canceled', errorCode: 'CANCEL_DURING_RECOVERY' } })).toBe(
      'CANCEL_DURING_RECOVERY',
    );
    expect(deriveRunErrorCode({ status: { status: 'canceled' } })).toBeUndefined();
    expect(deriveRunErrorCode({ status: { status: 'canceled', errorCode: null } })).toBeUndefined();
  });

  it('prefers the structured error code stamped on a failed run', () => {
    expect(
      deriveRunErrorCode({ status: { status: 'failed', errorCode: 'RATE_LIMITED', signal: 'SIGKILL', exitCode: 1 } }),
    ).toBe('RATE_LIMITED');
  });

  it('derives AGENT_SIGNAL_* when a failed run carries only a signal', () => {
    expect(deriveRunErrorCode({ status: { status: 'failed', signal: 'SIGKILL' } })).toBe('AGENT_SIGNAL_SIGKILL');
  });

  it('derives AGENT_EXIT_* when a failed run carries only a non-zero exit code', () => {
    expect(deriveRunErrorCode({ status: { status: 'failed', exitCode: 137 } })).toBe('AGENT_EXIT_137');
  });

  it('falls back to AGENT_TERMINATED_UNKNOWN for a zero exit or no signal at all', () => {
    expect(deriveRunErrorCode({ status: { status: 'failed', exitCode: 0 } })).toBe('AGENT_TERMINATED_UNKNOWN');
    expect(deriveRunErrorCode({ status: { status: 'failed' } })).toBe('AGENT_TERMINATED_UNKNOWN');
    expect(deriveRunErrorCode({ status: { status: 'failed', errorCode: null, exitCode: null, signal: null } })).toBe(
      'AGENT_TERMINATED_UNKNOWN',
    );
  });
});
