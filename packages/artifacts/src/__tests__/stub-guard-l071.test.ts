import { expect, it } from 'vitest';
import { readArtifactStubGuardConfigFromEnv, type ArtifactStubGuardConfig } from '../stub-guard.js';

const names = { mode: 'MODE', minRatio: 'RATIO', minPriorBytes: 'BYTES' };
const defaults: ArtifactStubGuardConfig = { mode: 'reject', minRetainedRatio: 0.7, minPriorBytes: 123, siblingExtensions: ['.txt'] };

it.each([
  { env: {}, mode: 'reject', ratio: 0.7, bytes: 123 },
  { env: { MODE: 'WARN', RATIO: '1', BYTES: '1' }, mode: 'warn', ratio: 1, bytes: 1 },
  { env: { MODE: 'off', RATIO: '0.25', BYTES: '2048' }, mode: 'off', ratio: 0.25, bytes: 2048 },
  { env: { MODE: 'reject', RATIO: 'NaN', BYTES: 'Infinity' }, mode: 'reject', ratio: 0.7, bytes: 123 },
  { env: { MODE: ' warn ', RATIO: '0', BYTES: '0' }, mode: 'reject', ratio: 0.7, bytes: 123 },
  { env: { MODE: '', RATIO: '-1', BYTES: '-1' }, mode: 'reject', ratio: 0.7, bytes: 123 },
  { env: { MODE: 'other', RATIO: '1.1', BYTES: '1.5' }, mode: 'reject', ratio: 0.7, bytes: 123 },
  { env: { MODE: undefined, RATIO: '', BYTES: '' }, mode: 'reject', ratio: 0.7, bytes: 123 },
])('preserves custom defaults and numeric boundaries for $env', ({ env, mode, ratio, bytes }) => {
  expect(readArtifactStubGuardConfigFromEnv({ env, names }, { defaults })).toEqual({ mode, minRetainedRatio: ratio, minPriorBytes: bytes, siblingExtensions: defaults.siblingExtensions });
});
