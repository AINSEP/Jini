import { expect, test } from 'vitest';
import { surfaceNeedsRecovery } from '../useSurfaceRecovery.js';

test('returning to an unanswered card restores it while an answered card stays complete', () => {
  const call = { name: 'save', input: {} };
  expect(surfaceNeedsRecovery({ call, runStreaming: true })).toBe(false);
  expect(surfaceNeedsRecovery({ call, runStreaming: false })).toBe(true);
  expect(surfaceNeedsRecovery({ call: { ...call, result: { content: 'The approval expired', isError: false } }, runStreaming: false })).toBe(true);
  expect(surfaceNeedsRecovery({ call: { ...call, result: { content: 'Saved', isError: false } }, runStreaming: false })).toBe(false);
});
