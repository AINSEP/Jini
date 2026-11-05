import { expect, it } from 'vitest';
import { startupFailureMessage } from '../diagnostics.js';

it('keeps the startup stage, error code and nested cause without leaking credentials', () => {
  const error = new Error('bridge preparation failed', { cause: Object.assign(new Error('spawn /bin/agent ENOENT; Bearer tiny-secret'), { code: 'ENOENT' }) });
  const message = startupFailureMessage({ stage: 'CLI launch', error });
  expect(message).toContain('CLI launch');
  expect(message).toContain('ENOENT');
  expect(message).toContain('bridge preparation failed');
  expect(message).toContain('send again');
  expect(message).not.toContain('tiny-secret');
});

it('redacts before truncating, bounds UTF-8 bytes, and keeps the deepest cause first', () => {
  const error = new Error('界'.repeat(3000), { cause: new Error('missing executable; api_key=short-key') });
  const message = startupFailureMessage({ stage: 'session binding', error });
  expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(2048);
  expect(message).toContain('missing executable');
  expect(message).not.toContain('short-key');
  expect(message).not.toContain('\uFFFD');
});

it('handles plain thrown values, cyclic causes and hostile getters without throwing', () => {
  expect(startupFailureMessage({ stage: 'attachments', error: 'file missing' })).toContain('file missing');
  const cycle: { message: string; cause?: unknown } = { message: 'cyclic failure' }; cycle.cause = cycle;
  expect(startupFailureMessage({ stage: 'plugins', error: cycle })).toContain('cyclic failure');
  const hostile = { get message(): string { throw new Error('getter failed'); } };
  expect(startupFailureMessage({ stage: 'plugins', error: hostile })).toContain('error details could not be read');
});
