import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ChatUsageSummary } from '../../../core/turn-usage.js';
import { usageEndLabel, usageLayout, usageLineMeetsActions, useUsageSummary } from '../MessageRow.usage.js';
import { I18nContext } from '../../hooks/context.js';
import { createElement, type ReactNode } from 'react';

afterEach(cleanup);

it('lets terminal failure and pending answers take precedence over model stop reasons', () => {
  const usage: ChatUsageSummary = { kind: 'usage', stopReason: 'end_turn' };
  expect(usageEndLabel({ usage })).toBe('Done');
  expect(usageEndLabel({ usage: { ...usage, stopReason: 'max_tokens' } })).toBe('Interrupted');
  expect(usageEndLabel({ usage: { ...usage, stopReason: 'error' } })).toBe('Failed');
  expect(usageEndLabel({ usage: { ...usage, stopReason: 'error' }, awaitingAnswer: true })).toBe('Waiting for your answer');
  expect(usageEndLabel({ usage, awaitingAnswer: true, message: { id: 'm', role: 'assistant', content: '', runStatus: 'failed' } })).toBe('Failed');
  expect(usageEndLabel({ usage, message: { id: 'm', role: 'assistant', content: '', runStatus: 'canceled' } })).toBe('Stopped');
});

it.each([['en-US', '1,040'], ['de-DE', '1.040']])('uses readable output-token units and the %s locale', (locale, count) => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(I18nContext.Provider, {
    value: { locale, t: (key, vars) => key.replace('{n}', String(vars?.n)) }, children,
  });
  const { result } = renderHook(() => useUsageSummary({ usage: { kind: 'usage', outputTokens: 1040, durationMs: 1000 } }), { wrapper });
  expect(result.current.title).toBe(`${count} output tokens`);
  expect(result.current.ariaLabel).toBe(`Done · 1s · ${count} output tokens`);
});

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

it('counts a known prefix total as text only when totals are shown', () => {
  const finished = { footer: { kind: 'usage' as const, totalCostUsd: 0.93 }, terminalNotice: null, pending: false, runInProgress: false };
  expect(usageLineMeetsActions(finished)).toBe(true);
  expect(usageLineMeetsActions(finished, { showTotal: false })).toBe(false);
  expect(usageLineMeetsActions({ ...finished, footer: { kind: 'usage', totalCostUsd: 0 } })).toBe(true);
  expect(usageLineMeetsActions({ ...finished, footer: { ...finished.footer, durationMs: 31_525 } }, { showTotal: false })).toBe(true);
});

it.each<{ name: string; usage: ChatUsageSummary; showTotal: boolean; text: string }>([
  { name: 'unknown cost with duration and a known total', usage: { kind: 'usage', durationMs: 31_525, totalCostUsd: 0.93, outputTokens: 93 }, showTotal: true, text: '32s · total $0.93' },
  { name: 'unknown cost with only a known total', usage: { kind: 'usage', totalCostUsd: 0.93 }, showTotal: true, text: 'total $0.93' },
  { name: 'a known zero total', usage: { kind: 'usage', totalCostUsd: 0 }, showTotal: true, text: 'total $0.00' },
  { name: 'a fractional-cent total', usage: { kind: 'usage', totalCostUsd: 0.004 }, showTotal: true, text: 'total $0.01' },
  { name: 'unknown duration, cost and total', usage: { kind: 'usage', outputTokens: 93 }, showTotal: true, text: '' },
  { name: 'unknown cost and total with duration', usage: { kind: 'usage', durationMs: 31_525 }, showTotal: true, text: '32s' },
  { name: 'a hidden total with duration', usage: { kind: 'usage', durationMs: 31_525, totalCostUsd: 0.93 }, showTotal: false, text: '32s' },
  { name: 'a hidden total without duration', usage: { kind: 'usage', totalCostUsd: 0.93 }, showTotal: false, text: '' },
  { name: 'a reported cost and total', usage: { kind: 'usage', costUsd: 0.1, totalCostUsd: 0.93 }, showTotal: true, text: '$0.10 · total $0.93' },
  { name: 'a reported cost with totals hidden', usage: { kind: 'usage', costUsd: 0.1, totalCostUsd: 0.93 }, showTotal: false, text: '$0.10' },
])('formats partial usage: $name', ({ usage, showTotal, text }) => {
  const { result } = renderHook(() => useUsageSummary({ usage }, { showTotal }));
  expect(result.current.text).toBe(text);
  expect(result.current.title).toBe(usage.outputTokens === undefined ? undefined : '93 output tokens');
  expect(result.current.ariaLabel).toBe(usage.outputTokens === undefined ? undefined : `Done · ${text} · 93 output tokens`);
});
