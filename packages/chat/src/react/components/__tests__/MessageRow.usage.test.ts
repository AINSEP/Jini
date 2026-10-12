import { expect, it } from 'vitest';
import type { ChatUsageSummary } from '../../../core/turn-usage.js';
import { usageLayout, usageLineMeetsActions } from '../MessageRow.usage.js';

const first: ChatUsageSummary = { kind: 'usage', costUsd: 0.25, totalCostUsd: 0.25 };
const second: ChatUsageSummary = { kind: 'usage', costUsd: 0.5, totalCostUsd: 0.75 };
const whole: ChatUsageSummary = { kind: 'usage', costUsd: 0.75, totalCostUsd: 0.75, segments: [first, second] };

it('puts every finished reply on its own line and the last reply in the footer once the run is over', () => {
  expect(usageLayout({ usage: whole, interleaved: true, runInProgress: false })).toEqual({ footer: second, replies: [first] });
});

it('keeps the finished replies but no footer while the last reply is still running', () => {
  expect(usageLayout({ usage: whole, interleaved: true, runInProgress: true })).toEqual({ footer: undefined, replies: [first] });
});

it('falls back to one whole-message footer when the flat layout cannot place reply ends', () => {
  expect(usageLayout({ usage: whole, interleaved: false, runInProgress: false })).toEqual({ footer: whole, replies: [] });
  expect(usageLayout({ usage: undefined, interleaved: true, runInProgress: false })).toEqual({ footer: undefined, replies: [] });
});

it('treats a still-streaming row as running even when its runStatus was never set', () => {
  expect(usageLayout({ usage: whole, interleaved: true, runInProgress: false }, { runStreaming: true })).toEqual({ footer: undefined, replies: [first] });
  expect(usageLayout({ usage: whole, interleaved: false, runInProgress: false }, { runStreaming: true })).toEqual({ footer: undefined, replies: [] });
});

it('flags the row only when a non-empty "Done" line sits directly above the copy row', () => {
  const finished = { footer: second, terminalNotice: null, pending: false, runInProgress: false };
  expect(usageLineMeetsActions(finished)).toBe(true);
  expect(usageLineMeetsActions({ ...finished, footer: undefined })).toBe(false);
  expect(usageLineMeetsActions({ ...finished, footer: { kind: 'usage', outputTokens: 12 } })).toBe(false);
  expect(usageLineMeetsActions({ ...finished, terminalNotice: 'Stopped' })).toBe(false);
  expect(usageLineMeetsActions({ ...finished, pending: true })).toBe(false);
  expect(usageLineMeetsActions({ ...finished, runInProgress: true })).toBe(false);
});
